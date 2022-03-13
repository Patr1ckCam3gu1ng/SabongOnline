let websocket;
let tab = { id: 0 };
let crfTokenValue = '';
let wssUrl = '';

let reconnectRetries = 0;
let retryPinger;

betLevel = [
    99,
    99,
    230,
    520,
    1170,
    2630,
    5570,
    12120,
    26400
]; // 48,840

let dailyProfitQuotaLimit = 70;

let overallQuota = 2500;

//should remain 'let' so we can change it in the console:
let maxWaitTimes = 62;

const meron = 'meron';
const wala = 'wala';

let pinger;

let presentLevel = 0;
let isBetSubmitted = false;
let finalBetside = '';
let isMatchWin = false;
let isPendingPrintProfit = false;
let isQuotaReachedPrinted = false;
let isExtendedBet = false;
let matchIndex = 1;
let betAmountPlaced = 0;
let isWinner = false;
let isLastMatchDraw = false;
let timer;
let timerIndex = 0;
let isDemoOnly = true;
let matchLogs = [{
    betAmountPlaced: 0,
    fightNumber: 1,
    isWin: true,
    odds: 1,
    sum: 0,
    presentLevel: 0,
    isExtendedBet: false
}];
let skipMatchesCount = -1;
const maxSkipMatches = 4;
let fightNumber = 1;
let forceDisconnect = false;
const shuffleValues = [meron, wala, meron, wala, meron, wala, meron, wala];
let remainingCurrentPoints = 0;

function createWebSocketConnection(crfToken, webserviceUrl) {
    if (crfTokenValue === '') {
        crfTokenValue = crfToken;
    }
    if (wssUrl === '') {
        wssUrl = webserviceUrl;
    }
    if ('WebSocket' in window) {
        websocketConnect(crfToken, webserviceUrl);
    }
}

const tabsOnUpdated = {
    setTabId: function (tabId) {
        chrome.storage.sync.set({ 'tabId': tabId },
            function () {
                tab.id = tabId;
            });
    }
}

const websocketConnect = (crfToken, webserviceUrl) => {
    if (websocket === undefined) {
        // console.log(`%c- Initializing -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');
        websocket = new WebSocket(webserviceUrl);
    }
    websocket.onopen = function () {
        const subscriptionBody = [
            'subscribe',
            {
                channel: 'betting',
                auth: {
                    endpoint: '/broadcasting/auth',
                    headers: {
                        'X-CSRF-TOKEN': crfToken
                    }
                }
            }
        ];
        websocket.send(`42${JSON.stringify(subscriptionBody)}`);
    };

    websocket.onmessage = async function (event) {
        if (event.data === '3') {
            return;
        }
        if (event.data === '40') {
            clearInterval(retryPinger);
            clearInterval(pinger);

            reconnectRetries = 0;
            // console.log(`%c- Connected -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');

            pinger = setInterval(function () {
                try {
                    websocket.send('2');
                } catch (e) {
                }
            }, 15000);

            return;
        }
        if (event.data.substr(0, 2) === '0{') {
            return;
        }
        const data = JSON.parse(event.data.substr(2, event.data.length - 1));

        if (data.length === 0) {
            return;
        }

        const fightEvent = data[0];
        const isBetting = data[1] === 'betting';
        const { grossProfit } = calculateProfit();

        if (isDailyQuotaReached() === true) {
            // console.log(`%c\\( ﾟヮﾟ)/   Job Well Done! Php ${calculateTodaysProfit().totalNetProfit.toLocaleString()}   ✯⸜(*❛‿❛)⸝✯`, 'font-weight: bold; color: #FF00FF;');
            // console.log('%c-', 'color: black;');

            isQuotaReachedPrinted = true;
            isBetSubmitted = false;

            flushPreviousVariance();
            stopTimer();

            return;
        }

        if (presentLevel > betLevel.length - 1) {
            console.log('%c-', 'color: black;');
            console.log('%cGame Over! No more funds', 'font-weight: bold; color: #f00; font-size: 19px;');

            disconnect();
            return;
        }
        else if (grossProfit >= overallQuota) {
            console.log(`%cCongratulations! Net Profit: ${printProfit()}`, 'font-weight: bold; color: #ffdc11; font-size: 15px;');

            disconnect();
            return;
        }

        if (fightEvent === 'App\\Events\\FightUpdate') {
            const fightData = data[2].data;
            const fightStatus = fightData.status;
            const winner = fightData.winner;
            const isOpenBet = fightData.open_bet === 'yes';
            const isNewFight = fightData.newFight === 'yes';
            const meronOdds = fightData.meron_equalpoint;
            const walaOdds = fightData.wala_equalpoint;
            fightNumber = fightData.fight_number;

            stopTimer();

            // Fix issue whereas the betting is closed but bet is not yet submitted
            if (timerIndex > 0) {
                clearTimeout(timer);
                timerIndex = 0;
            }

            if (fightStatus === 'cancelled' && isOpenBet === false) {
                paymentSafe(false);

                isBetSubmitted = false
                return;
            }
            if (fightStatus === 'finished' && isOpenBet === false && isBetting === true) {
                matchIndex += 1;

                isWinner = winner === finalBetside;

                isLastMatchDraw = winner === 'draw';

                if (skipMatchesCount >= 0) {
                    skipMatchesCount -= 1;
                    if (skipMatchesCount === 0) {
                        skipMatchesCount = -1;
                        chrome.tabs.sendMessage(tab.id, { text: "reload" });
                    }
                }
                if (finalBetside === '' || isBetSubmitted === false) {
                    isBetSubmitted = false;
                    return;
                }
                if (isBetSubmitted === true) {
                    if (isLastMatchDraw) {
                        paymentSafe(isLastMatchDraw);
                        isBetSubmitted = false;

                        return;
                    }

                    const odds = (finalBetside === wala ? walaOdds : meronOdds);
                    const winningSum = (betAmountPlaced * odds) - betAmountPlaced;

                    isMatchWin = false;

                    if (isWinner === true) {
                        setMatchLogs(fightNumber, isWinner, winningSum, betAmountPlaced, odds);

                        isMatchWin = isWinner;

                        console.log(`%cCongratulations! ${presentLevel > 6 ? `(${presentLevel - 1})` : ''}`, 'font-weight: bold; color: green', `+${winningSum.toFixed(0).toLocaleString()} => ${((odds * 100) - 100).toFixed(0)}%`);

                        presentLevel = 0;
                    } else {
                        setMatchLogs(fightNumber, isWinner, -betAmountPlaced, betAmountPlaced);

                        presentLevel += 1;

                        if (presentLevel === 4 && skipMatchesCount === -1) {
                            skipMatchesCount = maxSkipMatches;
                            chrome.tabs.sendMessage(tab.id, { text: "reload" });
                        }

                        console.log(`%cYou lose! ${presentLevel > 6 ? `(${presentLevel})` : ''}`, 'font-weight: bold; color: red');
                    }

                    betAmountPlaced = 0;

                    printCurrentPoints();
                    printDummyBet();
                }

                isBetSubmitted = false;
                betAmountPlaced = 0;
                isExtendedBet = false;

                if (fightNumber % 6 === 1) {
                    chrome.tabs.sendMessage(tab.id, { text: "reload" });
                }

                maxWaitTimes = generateRandomWaitTime();

                return;
            }
            if (fightStatus === 'on-going' && isOpenBet === false && isNewFight === false) {
                printPossibleWinnings();

                return;
            }
        }
        if (fightEvent === 'App\\Events\\BettingPosted' && isBetting === true) {
            printCurrentPoints();

            if (isBetSubmitted === true) {
                stopTimer();
                return;
            }
            if (timerIndex === 0 && skipMatchesCount === -1) {
                startTimer();
            }

            printDummyBet();

            if (timerIndex < 10) {
                chrome.tabs.sendMessage(tab.id, { text: 'isClosed' },
                    async function (isClosed) {
                        if (isClosed === true) {
                            stopTimer();
                        }
                    }
                );
            }

            if (skipMatchesCount >= 0) {
                printRemainingSkipMatches();
            }

            if ((timerIndex + 4) <= maxWaitTimes) {
                if (betAmountPlaced > 0 && timerIndex > 5) {
                    betAmountPlaced = 0;
                    printCurrentPoints();
                    printDummyBet();
                }

                return;
            }

            stopTimer();

            if ([0, 1].includes((matchIndex / 10) % 2)) {
                isPendingPrintProfit = true;
            }
            if (isMatchWin === true && isPendingPrintProfit === true) {
                isPendingPrintProfit = false;

                // printProfit();
            }

            if ([0, 1].includes(matchIndex / 8 % 2)) {
                printLine();
            } else {
                printLine();
            }

            setFinalBet();

            betAmountPlaced = parseInt(betLevel[presentLevel]);

            chrome.tabs.sendMessage(tab.id, { text: "inputBet", betAmountPlaced });
            await chromeSendMessage(chrome.tabs);

            if (isBetSubmitted === true) {
                stopTimer();
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            chrome.tabs.sendMessage(tab.id, { text: "submittedBetValue", betSide: finalBetside },
                async function (submittedBetValue) {
                    if (submittedBetValue === 0) {
                        chrome.tabs.sendMessage(tab.id, { text: "submitBet" });

                        printDummyBet();
                    }
                }
            );

            if (isDemoOnly === true) {
                isBetSubmitted = true;
            } else {
                await new Promise(resolve => setTimeout(resolve, 2500));

                chrome.tabs.sendMessage(tab.id, { text: "submittedBetValue", betSide: finalBetside },
                    async function (submittedBetValue) {
                        isBetSubmitted = submittedBetValue > 0;
                    }
                );
            }
        }
    }
    websocket.onclose = function () {
        if (reconnectRetries > 0) {
            return;
        }

        clearInterval(pinger);
        // console.log(`%c- Interrupted -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');

        if (!(presentLevel > betLevel.length - 1) && isDailyQuotaReached() === false && forceDisconnect === false) {
            retryPinger = setInterval(function () {
                if (reconnectRetries >= 3) {
                    const localTime = new Date().toLocaleTimeString();
                    console.log(`%c- Terminated on ${localTime} -`, 'font-weight: bold; color: red; font-size: 12px;');

                    websocket.close();
                    websocket = undefined;
                    clearInterval(retryPinger);
                    clearInterval(pinger);
                    isBetSubmitted = false;
                    return;
                }
                if (crfTokenValue !== '') {
                    // console.log('%c- Reconnecting -', 'font-weight: bold; color: #00ff00; font-size: 12px;');
                    websocket = new WebSocket(wssUrl);
                    createWebSocketConnection(crfTokenValue);
                }
                reconnectRetries += 1;
            }, 12000);
        }
    };
}

function setMatchLogs(fightNumber, isWin, sum, betAmountPlaced, odds) {
    matchLogs.push({ fightNumber, isWin, sum, betAmountPlaced, odds, isExtendedBet });
}

function startTimer() {
    timer = setInterval(function () {
        timerIndex += 1;
        if (isBetSubmitted === false && (timerIndex - 4) <= maxWaitTimes) {
            try {
                chrome.tabs.sendMessage(tab.id, { text: "hasAttributes" },
                    function (response) {
                        if (typeof response !== 'undefined') {
                            const addOnSeconds = 10;

                            if (response.isMinus === true) {
                                timerIndex -= addOnSeconds;
                            }
                            if (response.isAdd === true) {
                                timerIndex += addOnSeconds;
                            }
                        }

                        chrome.tabs.sendMessage(tab.id, { text: "printRemainingTime", timerIndex, maxWaitTimes });
                    }
                );
            } catch (e) {

            }
        }
    }, 1000);
}

function printRemainingSkipMatches() {
    if (skipMatchesCount >= 0) {
        chrome.tabs.sendMessage(tab.id, { text: "printRemainingSkipMatches", indexSkip: skipMatchesCount, maxSkip: maxSkipMatches });
    }
}

function stopTimer() {
    clearTimeout(timer);
    timerIndex = 0;
}

function setFinalBet() {
    let mainIndex = 0;
    while (mainIndex < randomPowerLawDistribution(20, 100)) {
        let subIndex = 0;
        while (subIndex < 100) {
            const shuffledArrays = shuffleArrays([...shuffleValues]);
            const pickedSide = shuffleBetSide(shuffledArrays);

            if (typeof pickedSide !== 'undefined') {
                finalBetside = pickedSide;
                break;
            }

            subIndex += 1;
        }
        mainIndex += 1;
    }
}

function paymentSafe(isDraw) {
    if (isDraw === false && isBetSubmitted === false && timerIndex > 1) {
        printLine();
    }

    // console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
}

function printProfit() {
    const { grossProfit } = calculateProfit();

    return grossProfit.toLocaleString();
}

function generateRandomWaitTime() {
    return randomPowerLawDistribution(20, 64);
}

function randomPowerLawDistribution(min, max) {
    return Math.ceil(Math.exp(Math.random() * (Math.log(max) - Math.log(min))) * min)
}

function printLine() {
    // console.log('%c-', 'color: black;');
}

function calculateProfit() {
    const wonMatches = matchLogs.filter(c => c.isWin === true);
    const lossMatches = matchLogs.filter(c => c.isWin === false);

    const grossProfit = parseInt(matchLogs.map(({ sum }) => sum).reduce((a, b) => a + b, 0));
    const {
        totalNetProfit: todaysTotalNetProfit
    } = calculateTodaysProfit();

    return {
        wonMatches: wonMatches.length,
        lossMatches: lossMatches.length,
        //
        grossProfit: grossProfit,
        //
        todaysTotalNetProfit
    }
}

function calculateTodaysProfit() {
    const wonMatches = [...matchLogs].slice(1).filter(c => c.isWin === true);
    const lossMatches = [...matchLogs].slice(1).filter(c => c.isWin === false);

    const wonMatchesTotalGrossProfit = parseInt(wonMatches.map(({ sum }) => sum).reduce((a, b) => a + b, 0));
    const lossMatchesTotalGrossProfit = parseInt(lossMatches.map(({ sum }) => sum).reduce((a, b) => a + b, 0));

    return {
        totalNetProfit: wonMatchesTotalGrossProfit + lossMatchesTotalGrossProfit
    }
}

function isDailyQuotaReached() {
    const { totalNetProfit } = calculateTodaysProfit();

    return totalNetProfit >= dailyProfitQuotaLimit;
}

function flushPreviousVariance() {
    const { totalNetProfit } = calculateTodaysProfit();

    const sum = matchLogs[0].sum + totalNetProfit;

    chrome.storage.local.clear();

    matchLogs = [];
    matchLogs.push({ fightNumber: 1, isWin: true, sum, betAmountPlaced: 0 });

    remainingCurrentPoints = 0;
    betAmountPlaced = 0;
    matchIndex = 1;
    isPendingPrintProfit = false;
    skipMatchesCount = -1;

    finalBetside = '';
}

async function chromeSendMessage(chromeTabs) {
    await new Promise(resolve => setTimeout(resolve, 500));
    chromeTabs.sendMessage(tab.id, { text: 'placeBet', betSide: finalBetside });
}

function shuffleArrays(array) {
    let oldElement;
    for (let i = array.length - 1; i > 0; i--) {
        let rand = Math.floor(Math.random() * (i + 1));
        oldElement = array[i];
        array[i] = array[rand];
        array[rand] = oldElement;
    }

    return [...array];
}

function shuffleBetSide(value) {
    let shuffledValues = [...value];
    let shuffledBuckets = [];
    let index = 0;

    while (index < randomPowerLawDistribution(20, 100)) {
        const shuffledArrays = shuffleArrays(shuffledValues);
        for (const shuffledArr of shuffledArrays) {
            shuffledBuckets.push(shuffledArr);
        }

        index += 1;
    }

    const indexPicked = Math.floor(Math.random() * (shuffledBuckets.length - 1));

    return shuffledBuckets[indexPicked];
}

function disconnect() {
    flushPreviousVariance();
    stopTimer();

    chrome.tabs.sendMessage(tab.id, { text: 'logout' });

    clearInterval(pinger);

    websocket.close();

    forceDisconnect = true;
    reconnectRetries = 999;
}

function printCurrentPoints() {
    const { grossProfit } = calculateProfit();

    if (isBetSubmitted === true) {
        chrome.tabs.sendMessage(tab.id, { text: "setRemainingDummyPoints", remainingPoints: grossProfit - betAmountPlaced });
    } else {
        chrome.tabs.sendMessage(tab.id, { text: "setRemainingDummyPoints", remainingPoints: grossProfit });
    }
}

async function getInitialPoints() {
    printRemainingSkipMatches();

    if (isDemoOnly === true) {
        printCurrentPoints();
        printDummyBet();

        maxWaitTimes = generateRandomWaitTime();

        printPossibleWinningsIfClosed().then(r => r);

        return;
    }
    chrome.tabs.sendMessage(tab.id, { text: "remainingPoints", withReplace: true },
        async function (value) {
            remainingCurrentPoints = value;

            if (isMatchWin === true && presentLevel === 0 && matchLogs.length === 1) {
                matchLogs[0].sum = parseInt(value) - parseInt(betLevel.map(sum => sum).reduce((a, b) => a + b, 0));
            }

            printCurrentPoints();
            printDummyBet();
            maxWaitTimes = generateRandomWaitTime();
        }
    );
}

function printDummyBet() {
    if (isDemoOnly === true) {
        chrome.tabs.sendMessage(tab.id, { text: "submitDummyBet", betAmountPlaced, betSide: finalBetside });
    }
}

function printPossibleWinnings() {
    if (isDemoOnly === true) {
        chrome.tabs.sendMessage(tab.id, { text: "getClosedOdds", betSide: finalBetside },
            async function (closedOdds) {
                chrome.tabs.sendMessage(tab.id, {
                    text: "submitDummyBet",
                    betAmountPlaced,
                    betSide: finalBetside,
                    calculatedWinning: betAmountPlaced * (closedOdds / 100)
                });
            }
        );
    }
}

async function printPossibleWinningsIfClosed() {
    if (isBetSubmitted === true) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        chrome.tabs.sendMessage(tab.id, { text: 'isClosed' },
            async function (isClosed) {
                if (isClosed === true) {
                    printPossibleWinnings();
                }
            }
        );
    }
}

chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.status === "complete") {
        tabsOnUpdated.setTabId(tabId);
        if (crfTokenValue !== '') {
            getInitialPoints().then(r => r);
        }
    }
});

chrome.extension.onConnect.addListener(function (port) {
    port.onMessage.addListener(function () {
        if (port.name === 'getCrfToken') {
            chrome.tabs.sendMessage(tab.id, { text: "getCrfTokenRequest" },
                function (crfToken) {
                    chrome.tabs.sendMessage(tab.id, { text: "ancestorOrigins" },
                        function (wssUrl) {
                            createWebSocketConnection(crfToken, wssUrl);
                            getInitialPoints().then(r => r);
                        }
                    );
                }
            );
        }
    });
});

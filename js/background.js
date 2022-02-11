let websocket;
let tab = { id: 0 };
let crfTokenValue = '';
let wssUrl = 'wss://echo.wpc2028.live/socket.io/?EIO=3&transport=websocket';

let reconnectRetries = 0;
let retryPinger;

betLevel = [
    150,
    300,
    650,
    1450,
    3250,
    7350,
    16400,
    36950
];

let dailyProfitQuotaLimit = 100;

let overallQuota = (betLevel[0] * 1000);

//should remain 'let' so we can change it in the console:
let maxWaitTimes = 78;

const meron = 'meron';
const wala = 'wala';

let pinger;

let presentLevel = 0;
let isBetSubmitted = false;
let finalBetside = '';
let isBetOnHigherRoi = false;
let isMatchWin = false;
let isPendingPrintProfit = false;
let isQuotaReachedPrinted = false;
let isExtendedBet = false;
let totalLossCountByFar = 0;

let matchIndex = 1;
let winCount = 0;
let lossCount = 0;
let drawCount = 0;
let winStreak = 0;
let highestLossStreak = 0;
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

let fightNumber = 1;

let forceDisconnect = false;

function createWebSocketConnection(crfToken) {
    if (crfTokenValue === '') {
        crfTokenValue = crfToken;
    }
    if ('WebSocket' in window) {
        websocketConnect(crfToken);
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

const websocketConnect = (crfToken) => {
    if (websocket === undefined) {
        // console.log(`%c- Initializing -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');
        websocket = new WebSocket(wssUrl);
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
            console.log(`%c\\( ﾟヮﾟ)/ Job Well Done! Quota reached: Php ${calculateTodaysProfit().totalNetProfit.toLocaleString()} ✯⸜(*❛‿❛)⸝✯`, 'font-weight: bold; color: #FF00FF;');
            console.log('%c-', 'color: black;');

            isQuotaReachedPrinted = true;
            isBetSubmitted = false;

            flushPreviousVariance();
            stopTimer();

            return;
        }

        if (presentLevel > betLevel.length - 1) {
            printLine();

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

                if (isBetSubmitted === true) {
                    if (isLastMatchDraw) {
                        paymentSafe(isLastMatchDraw);
                        isBetSubmitted = false;

                        drawCount += 1;
                        return;
                    } else {
                        if (isWinner) {
                            winCount += 1;
                        } else {
                            lossCount += 1;
                            console.log('%cYou lose!', 'font-weight: bold; color: red');
                        }
                    }
                }
                if (finalBetside === '' || isBetSubmitted === false) {
                    isBetSubmitted = false;
                    return;
                }
                if (isBetSubmitted === true) {
                    const odds = (finalBetside === wala ? walaOdds : meronOdds);
                    const winningSum = (betAmountPlaced * odds) - betAmountPlaced;

                    isMatchWin = false;

                    if (isWinner === true) {
                        if (presentLevel === 0) {
                            winStreak += 1;
                        }

                        setMatchLogs(fightNumber, isWinner, winningSum, betAmountPlaced, odds);

                        isMatchWin = isWinner;
                        presentLevel = 0;
                        console.log('%cCongratulations!', 'font-weight: bold; color: green', `+${winningSum.toFixed(0).toLocaleString()} => ${((odds * 100) - 100).toFixed(0)}%`);
                    } else {
                        winStreak = 0;

                        setMatchLogs(fightNumber, isWinner, -betAmountPlaced, betAmountPlaced);

                        presentLevel += 1;

                        totalLossCountByFar += 1;
                    }

                    betAmountPlaced = 0;

                    printCurrentPoints();
                    submitDummyBet();
                }

                isBetSubmitted = false;
                betAmountPlaced = 0;
                isExtendedBet = false;

                // if (fightNumber % 4 === 1) {
                //     chrome.tabs.sendMessage(tab.id, { text: "reload" });
                // }
                if (fightNumber % 6 === 1) {
                    chrome.tabs.sendMessage(tab.id, { text: "reload" });
                }

                return;
            }
            if (fightStatus === 'on-going' && isOpenBet === false && isNewFight === false) {
                return;
            }
        }
        if (fightEvent === 'App\\Events\\BettingPosted' && isBetting === true) {
            printCurrentPoints();

            if (isBetSubmitted === true) {
                stopTimer();
                return;
            }
            if (timerIndex === 0) {
                startTimer();
            }

            submitDummyBet();

            if (timerIndex < 10) {
                chrome.tabs.sendMessage(tab.id, { text: 'isClosed' },
                    async function (isClosed) {
                        if (isClosed === true) {
                            stopTimer();
                        }
                    }
                );
            }
            if ((timerIndex + 4) <= maxWaitTimes) {
                if (betAmountPlaced > 0) {
                    betAmountPlaced = 0;
                    printCurrentPoints();
                    submitDummyBet();
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
                resetIndexCounter();
            } else {
                printLine();
            }

            const dataBetOdds = { value: data[2] };
            const clonedDataBetOdds = { ...dataBetOdds };

            if (matchLogs.length > 1) {
                reverseBet();
            }

            setFinalBet(clonedDataBetOdds.value);

            let bet = betLevel[presentLevel];

            betAmountPlaced = parseInt(bet);

            if (presentLevel === betLevel.length - 1 && isDemoOnly === false) {
                chrome.tabs.sendMessage(tab.id, { text: "remainingPoints" },
                    async function (remainingPoints) {
                        if (remainingPoints < betAmountPlaced) {
                            betAmountPlaced = parseInt(remainingPoints.toFixed(0))
                        }

                        chrome.tabs.sendMessage(tab.id, { text: 'inputBet', betAmountPlaced });
                        await chromeSendMessage(chrome.tabs);
                    }
                );
            } else {
                chrome.tabs.sendMessage(tab.id, { text: "inputBet", betAmountPlaced });
                await chromeSendMessage(chrome.tabs);
            }

            if (presentLevel === betLevel.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 800));
            }

            if (isBetSubmitted === true) {
                stopTimer();
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 500));

            chrome.tabs.sendMessage(tab.id, { text: "submittedBetValue", betSide: finalBetside },
                async function (submittedBetValue) {
                    if (submittedBetValue === 0) {
                        chrome.tabs.sendMessage(tab.id, { text: "submitBet" });

                        submitDummyBet();
                    }
                }
            );

            if (isDemoOnly === true) {
                isBetSubmitted = true;
            } else {
                await new Promise(resolve => setTimeout(resolve, 3500));

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

                        let shuffleIndex = 0;
                        while (shuffleIndex < 100) {
                            shuffleBetSide();
                            shuffleIndex += 1;
                        }
                    }
                );
            } catch (e) {

            }
        }
    }, 1000);
}

function resetIndexCounter() {
    lossCount = 0;
    winCount = 0;
    drawCount = 0;
}

function stopTimer() {
    clearTimeout(timer);
    timerIndex = 0;
}

function setFinalBet(fightData) {
    if (finalBetside === '') {
        isBetOnHigherRoi = shuffleBetSide();
    }

    finalBetside = (isBetOnHigherRoi
        ? (fightData.meron_odds > fightData.wala_odds) : (fightData.meron_odds < fightData.wala_odds))
        ? meron : wala;
}

function reverseBet() {
    if (fightNumber % 3 === 1) {
        isBetOnHigherRoi = shuffleBetSide();
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
    /*
     // const totalMatches = [...matchLogs].slice(1);

     console.log('%c-', 'color: black;');

     // console.log(`%cWin: ${wonMatches} | Loss: ${lossMatches} | Total Matches: ${totalMatches.length}`, 'font-weight: bold; color: yellow');
     // console.log(`%cWin Streak: ${highestWinStreak} | Loss Streak: ${highestLossStreak}`, 'font-weight: bold; color: yellow');
     // console.log(`%c---`, 'font-weight: bold; color: yellow');
     // console.log(`%cThis match's profit: Php ${todaysTotalNetProfit.toLocaleString()}`, 'font-weight: bold; color: yellow');
     // console.log(`%c---`, 'font-weight: bold; color: yellow');
     console.log(`%cOverall Matches Profit: Php ${grossProfit.toLocaleString()}`, 'font-weight: bold; color: yellow');*/
}

function randomInt() {
    const minMinutes = 8;
    const maxMinutes = 40;
    let index = 0;
    let indexPicked = 0;
    let pickList = [];

    while (index < 5) {
        indexPicked = Math.floor(Math.random() * maxMinutes);

        if (indexPicked >= minMinutes && indexPicked <= maxMinutes) {
            if (pickList.length > 0 && pickList.filter(c => c === indexPicked).length > 1) {
                continue
            }
            pickList.push(indexPicked);
            index++;
        }
    }

    return indexPicked;
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

    resetIndexCounter();

    highestLossStreak = 0;
    winStreak = 0;
    matchIndex = 1;
    isPendingPrintProfit = false;

    // will be reverse once it re-commence:
    isBetOnHigherRoi = true;

    finalBetside = '';
}

function millisecondsConverter(millis) {
    const ms = millis % 1000;
    millis = (millis - ms) / 1000;

    const secs = millis % 60;
    millis = (millis - secs) / 60;

    const mins = millis % 60;
    const hrs = (millis - mins) / 60;

    if (hrs === 0) {
        return mins + ' minutes';
    }

    return hrs + ` hour${hrs > 1 ? 's' : ''} and ` + mins + ' minutes';
}

async function chromeSendMessage(chromeTabs) {
    await new Promise(resolve => setTimeout(resolve, 500));
    chromeTabs.sendMessage(tab.id, { text: 'placeBet', betSide: finalBetside });
}

function shuffleBetSide() {
    const shuffleArrays = (array) => {
        let oldElement;
        for (let i = array.length - 1; i > 0; i--) {
            let rand = Math.floor(Math.random() * (i + 1));
            oldElement = array[i];
            array[i] = array[rand];
            array[rand] = oldElement;
        }

        return array;
    }

    const maxLoop = 3;

    let shuffledTrueFalse = [true, false];
    let shuffledTrueFalseBuckets = [];
    let index = 0;

    while (index < (Math.floor(parseInt(((Math.random() * maxLoop) + 1).toFixed(0))))) {
        shuffledTrueFalse = shuffleArrays(shuffledTrueFalse);
        shuffledTrueFalseBuckets.push(...shuffledTrueFalse);
        index++;
    }

    let indexPicked = 0;
    let indexPickedHistory = [];
    index = 0;

    while (index <= (Math.floor(parseInt(((Math.random() * maxLoop) + 1).toFixed(0))))) {
        const picked = Math.floor(Math.random() * shuffledTrueFalseBuckets.length);
        if (indexPickedHistory.filter(c => c === picked).length === 0) {
            indexPicked = picked;
            indexPickedHistory.push(picked);
        }

        index++;
    }

    return shuffledTrueFalseBuckets[indexPicked];
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
    if (isDemoOnly === false) {
        return;
    }
    const { grossProfit } = calculateProfit();

    if (isBetSubmitted === true) {
        chrome.tabs.sendMessage(tab.id, { text: "setRemainingDummyPoints", remainingPoints: grossProfit - betAmountPlaced });
    } else {
        chrome.tabs.sendMessage(tab.id, { text: "setRemainingDummyPoints", remainingPoints: grossProfit });
    }
}

function submitDummyBet() {
    if (isDemoOnly === true) {
        chrome.tabs.sendMessage(tab.id, { text: "submitDummyBet", betAmountPlaced, betSide: finalBetside });
    }
}

chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.status === "complete") {
        tabsOnUpdated.setTabId(tabId);

        printCurrentPoints();
        submitDummyBet();
    }
});
chrome.extension.onConnect.addListener(function (port) {
    port.onMessage.addListener(function () {
        if (port.name === 'getCrfToken') {
            chrome.tabs.sendMessage(tab.id, { text: "getCrfTokenRequest" },
                function (crfToken) {
                    createWebSocketConnection(crfToken);
                }
            );
        }
    });
});

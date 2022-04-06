let websocket;
let tab = { id: 0 };
let crfTokenValue = '';
let wssUrl = '';

let reconnectRetries = 0;
let retryPinger;

betLevel = [
    200,
    100
]; // 200

let overallQuota = 50;

//should remain 'let' so we can change it in the console:
let maxWaitTimes = 62;

const meron = 'meron';
const wala = 'wala';

let pinger;

let presentLevel = 0;
let isBetSubmitted = false;
let finalBetside = '';
let isMatchWin = false;
let matchIndex = 1;
let betAmountPlaced = 0;
let isWinner = false;
let isLastMatchDraw = false;
let timer;
let timerIndex = 0;
let isDemoOnly = false;
let skipMatchesCount = -1;
let fightNumber = 1;
let forceDisconnect = false;
const originalBetsideValues = [meron, wala, meron, wala];
let betsideValues = [];
let isLastBetUsed = false;
let isExtraProfitUsed = false;
let isSubmissionOpen = true;
let potWinnings = {
    win: 0,
    loss: 0
};
let currentPoints = 0;
let ignoreInitialSkipMatches = false;
let initialSkipMatchesInitialized = false;
let maxSkipMatches = 3;
let hasWithdrawnAlready = false;

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

        if (presentLevel > betLevel.length - 1) {
            console.log('%c-', 'color: black;');
            console.log('%cGame Over! No more funds', 'font-weight: bold; color: #f00; font-size: 19px;');

            disconnectThenWithdraw();
            return;
        }
        else if (calculateProfit() >= overallQuota) {
            console.log(`%cCongratulations! Net Profit: ${printProfit()}`, 'font-weight: bold; color: #ffdc11; font-size: 15px;');

            disconnectThenWithdraw();
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

                    if (skipMatchesCount <= 0) {
                        skipMatchesCount = -1;
                        ignoreInitialSkipMatches = true;

                        // chrome.tabs.sendMessage(tab.id, { text: "reload" });
                        betsideValues = [...originalBetsideValues];

                        chrome.tabs.sendMessage(tab.id, { text: "deletePrintRemainingSkipMatches" });
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
                        setPotWinnings(isWinner, winningSum);

                        isMatchWin = isWinner;

                        console.log(`%cCongratulations! ${presentLevel > 4 ? `(${presentLevel + 1})` : ''}`, 'font-weight: bold; color: green', `+${winningSum.toFixed(0).toLocaleString()} => ${((odds * 100) - 100).toFixed(0)}%`);

                        isExtraProfitUsed = false;
                        betsideValues = [...originalBetsideValues];

                        // if (presentLevel === betLevel.length - 1 && isLastBetUsed === false) {
                        //     console.log(`%Sorry! Bet level reduced`, 'font-weight: bold; color: #fdda11;');
                        //
                        //     betLevel.pop();
                        //     isLastBetUsed = true;
                        //
                        //     potWinnings.win = 0;
                        //     potWinnings.loss = 0;
                        // }

                        presentLevel = 0;
                    } else {
                        setPotWinnings(isWinner, betAmountPlaced);

                        presentLevel += 1;

                        // insertAdditionalBetsideValues();

                        console.log(`%cYou lose! ${presentLevel > 5 ? `(${presentLevel})` : ''}`, 'font-weight: bold; color: red');
                    }

                    betAmountPlaced = 0;

                    printCurrentPoints();
                    printDummyBet();

                    skipMatchesCount = maxSkipMatches = generateRandomIntFromGuid();

                    if (isFundsDepleted() === true) {
                        console.log('%cObjection Failed! Budget overrun', 'font-weight: bold; color: #f00; font-size: 19px;');
                        disconnectThenWithdraw();

                        return;
                    }
                }

                isBetSubmitted = false;
                isSubmissionOpen = true;
                betAmountPlaced = 0;

                // if (fightNumber % 6 === 1 && calculateProfit() < overallQuota) {
                //     chrome.tabs.sendMessage(tab.id, { text: "reload" });
                // }

                maxWaitTimes = generateRandomWaitTime();
                printBetLevelTable();
                setCurrentPoints();

                if (maxSkipMatches > -1) {
                    chrome.tabs.sendMessage(tab.id, { text: "deletePrintRemainingTime" });
                }

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

            if ([0, 1].includes(matchIndex / 8 % 2)) {
                printLine();
            } else {
                printLine();
            }

            setFinalBetside();

            // manageExtraProfit(0);
            // manageExtraProfit(1);

            betAmountPlaced = parseInt(betLevel[presentLevel]);

            if (presentLevel === betLevel.length - 1 && currentPoints < betLevel[presentLevel]) {
                betAmountPlaced = currentPoints;
            }

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
                if (isSubmissionOpen === false) {
                    return;
                }

                isSubmissionOpen = false;

                await new Promise(resolve => setTimeout(resolve, 2500));

                chrome.tabs.sendMessage(tab.id, { text: "submittedBetValue", betSide: finalBetside },
                    async function (submittedBetValue) {
                        isBetSubmitted = submittedBetValue > 0;
                        isSubmissionOpen = true;
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

        if (!(presentLevel > betLevel.length - 1) && forceDisconnect === false) {
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

function setPotWinnings(isWin, sum) {
    if (isWin === true) {
        potWinnings.win += sum;
    } else {
        potWinnings.loss += sum;
    }
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

// function setFinalBetside() {
//     let mainIndex = 0;
//     while (mainIndex < randomPowerLawDistribution(20, 100)) {
//         let subIndex = 0;
//         while (subIndex < 100) {
//             const shuffledArrays = shuffleArrays([...betsideValues]);
//             const pickedSide = shuffleBetSide(shuffledArrays);
//
//             if (typeof pickedSide !== 'undefined') {
//                 finalBetside = pickedSide;
//                 break;
//             }
//
//             subIndex += 1;
//         }
//         mainIndex += 1;
//     }
// }
function setFinalBetside() {
    let index = 0;
    while (index < 100) {
        const pickedSide = shuffleBetSide([...generateRandomBetArray()]);
        if (typeof pickedSide !== 'undefined') {
            finalBetside = pickedSide;
            break;
        }

        index += 1;
    }
}

function paymentSafe(isDraw) {
    if (isDraw === false && isBetSubmitted === false && timerIndex > 1) {
        printLine();
    }

    // console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
}

function printProfit() {
    return calculateProfit().toLocaleString();
}

function generateRandomWaitTime() {
    return randomPowerLawDistribution(22, 72);
}

function randomPowerLawDistribution(min, max) {
    const range = max - min;
    const requestBytes = Math.ceil(Math.log2(range) / 8);
    if (!requestBytes) { // No randomness required
        return min;
    }
    const maxNum = Math.pow(256, requestBytes);
    const ar = new Uint8Array(requestBytes);

    while (true) {
        window.crypto.getRandomValues(ar);

        let val = 0;
        for (let i = 0; i < requestBytes; i++) {
            val = (val << 8) + ar[i];
        }

        if (val < maxNum - maxNum % range) {
            return min + (val % range);
        }
    }
}

function printLine() {
    // console.log('%c-', 'color: black;');
}

function calculateProfit() {
    return potWinnings.win - potWinnings.loss;
}

function flushPreviousVariance() {
    chrome.storage.local.clear();

    betAmountPlaced = 0;
    matchIndex = 1;
    skipMatchesCount = -1;
    ignoreInitialSkipMatches = false;

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

// function shuffleBetSide(value) {
//     let shuffledValues = [...value];
//     let shuffledBuckets = [];
//     let index = 0;
//
//     while (index < randomPowerLawDistribution(1, 100)) {
//         const shuffledArrays = shuffleArrays(shuffledValues);
//         for (const shuffledArr of shuffledArrays) {
//             shuffledBuckets.push(shuffledArr);
//         }
//
//         index += 1;
//     }
//
//     // const indexPicked = Math.floor(Math.random() * (shuffledBuckets.length - 1));
//     const indexPicked = randomPowerLawDistribution(1, shuffledBuckets.length - 1)
//
//     return shuffledBuckets[indexPicked];
// }
function shuffleBetSide(generateRandomBetArray) {
    let shuffledBuckets = [...generateRandomBetArray];
    const indexPicked = randomPowerLawDistribution(1, shuffledBuckets.length - 1)

    return shuffledBuckets[indexPicked];
}

function disconnectThenWithdraw() {
    withdrawProfit();
}

function printCurrentPoints() {
    const profit = calculateProfit();

    if (isBetSubmitted === true) {
        chrome.tabs.sendMessage(tab.id, { text: "setRemainingDummyPoints", remainingPoints: profit - betAmountPlaced });
    } else {
        chrome.tabs.sendMessage(tab.id, { text: "setRemainingDummyPoints", remainingPoints: profit });
    }
}
function printBetLevelTable() {
    chrome.tabs.sendMessage(tab.id, { text: "printBetLevelTable", betLevel, presentLevel });
}

async function initialize() {
    printRemainingSkipMatches();
    printCurrentPoints();
    printDummyBet();
    printBetLevelTable();

    maxWaitTimes = generateRandomWaitTime();

    if (betsideValues.length === 0) {
        betsideValues = [...originalBetsideValues];
    }
    if (isDemoOnly === true) {
        printPossibleWinningsIfClosed().then(r => r);
    } else {
        chrome.tabs.sendMessage(tab.id, { text: "isLoginPage" },
            async function (isLoginPage) {
                if (isLoginPage === true) {
                    if (isFundsDepleted() === true || presentLevel > betLevel.length - 1) {
                        chrome.tabs.sendMessage(tab.id, { text: "printGameOver" });
                    } else if (calculateProfit() >= overallQuota) {
                        chrome.tabs.sendMessage(tab.id, { text: "printQuoteReached" });
                    }
                }
                else {
                    setCurrentPoints();
                }
            }
        );

        skipMatchOnFirstInit().then(r => r);
    }
}

async function skipMatchOnFirstInit() {
    if (ignoreInitialSkipMatches === false && initialSkipMatchesInitialized === false && potWinnings.win === 0 && potWinnings.loss === 0 && presentLevel === 0) {
        skipMatchesCount = maxSkipMatches = generateRandomIntFromGuid();
        initialSkipMatchesInitialized = true;

        await new Promise(resolve => setTimeout(resolve, 700));
        // chrome.tabs.sendMessage(tab.id, { text: "reload" });
    }
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

function isFundsDepleted() {
    const profit = calculateProfit();

    return -Math.abs(betLevel.reduce((partialSum, a) => partialSum + a, 0)) > profit;
}

function manageExtraProfit(addOn) {
    const hasExtraProfit = calculateProfit() >= (betLevel[0] * (1 + addOn));
    const indexAddon = 2 + addOn;
    // const addonBet = betLevel[0] / 2;
    const addonBet = isDemoOnly === true ? 99 : betLevel[0];

    if (hasExtraProfit === true && betLevel[indexAddon] !== addonBet) {
        betLevel.splice(2, 0, addonBet);
    }
    if (hasExtraProfit === false && betLevel[indexAddon] === addonBet && isExtraProfitUsed === false) {
        betLevel.splice(2, 1);
    }

    if (isExtraProfitUsed === false) {
        isExtraProfitUsed = presentLevel === indexAddon && betLevel[indexAddon] === addonBet;
    }
}
function insertAdditionalBetsideValues() {
    let index = 0;
    while (index < 2) {
        betsideValues.push(finalBetside === meron ? wala : meron);
        index += 1;
    }
}

function generateGuid() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

function generateRandomIntFromGuid() {
    let numberOnlyUid = [];
    for (const uid of generateGuid()) {
        if (uid === '-') {
            continue;
        }
        if (isNaN(uid) === false) {
            if (uid === '0') {
                numberOnlyUid.push(-1);
            }
            numberOnlyUid.push(parseInt(uid));
        }
    }
    return parseInt(numberOnlyUid[randomPowerLawDistribution(1, numberOnlyUid.length - 1)]);
}

function generateRandomBetArray() {
    const alphanumerics = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
        'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    let betArray = [];

    const randomOddEvenBetside = (randomPowerLawDistribution(2, 4) - 2);

    for (const uid of generateGuid()) {
        if (uid === '-') {
            continue;
        }
        [...alphanumerics].forEach((alphanumeric, alphanumericIndex) => {
            if (alphanumeric.toString() === uid.toString()) {
                betArray.push(((alphanumericIndex % 2 === randomOddEvenBetside) ? meron : wala).toString());
            }
        });
    }

    return betArray;
}

function setCurrentPoints() {
    if (presentLevel === betLevel.length - 1 && isFundsDepleted() === false) {
        chrome.tabs.sendMessage(tab.id, { text: "getLocationOrigin" },
            async function (url) {
                sendHttpRequestCurrentPoints(url, function (points) {
                    currentPoints = points;
                });
            }
        );
    }
}

function sendHttpRequestCurrentPoints(url, execFunc) {
    const xmlHttp = new XMLHttpRequest();
    xmlHttp.open("GET", url + '/arenainfo/6', false); // false for synchronous request
    xmlHttp.send(null);
    xmlHttp.onload = function () {
        const response = JSON.parse(xmlHttp.responseText);
        execFunc(parseInt(response.currentPoints.replace(',', '')));
    }()
}

function withdrawProfit() {
    const flush = () => {
        flushPreviousVariance();
        stopTimer();

        chrome.tabs.sendMessage(tab.id, { text: 'logout' });

        clearInterval(pinger);

        websocket.close();

        reconnectRetries = 999;
        forceDisconnect = true;
    };

    hasWithdrawnAlready === false && crfTokenValue !== '' && chrome.tabs.sendMessage(tab.id, { text: "getLocationOrigin" },
        async function (url) {
            sendHttpRequestCurrentPoints(url, function (points) {
                const totalBetLevel = betLevel.reduce((partialSum, a) => partialSum + a, 0);
                let profit = 0;
                let details = '';

                if (calculateProfit() >= overallQuota) {
                    // profit = (points - 100) - totalBetLevel;
                    profit = (points - 20) - totalBetLevel;
                    details = generateGuid();
                } else if (presentLevel > betLevel.length - 1) {
                    profit = points;
                    details = 'Game Over!'
                }

                console.log(`%cFunds withdrawn successfully: ${points}`, 'font-weight: bold; color: #ffdc11;');

                if (profit < 1) {
                    flush();
                    return;
                }

                const xhr = new XMLHttpRequest();
                xhr.open("POST", `${url}/cashrequest`, true);
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                xhr.send(`_token=${crfTokenValue}&type=withdrawal&amount=${profit}&details=${details}`);
                xhr.onload = function () {
                    flush();
                    hasWithdrawnAlready = true;
                }();
            });
        }
    );
}

chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.status === "complete") {
        tabsOnUpdated.setTabId(tabId);
        if (crfTokenValue !== '') {
            initialize().then(r => r);
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
                            initialize().then(r => r);
                        }
                    );
                }
            );
        }
    });
});

let websocket;
let tab = { id : 0 };
let crfTokenValue = '';
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

let reconnectRetries = 0;
let retryPinger;

// let betLevel = [
//     612, // 1
//     612, // 2
//     1292, // 3
//     2728, // 4
//     5759, // 5
//     12158, /* 23,161 */ // 6
//     25667, /* 48,216 */ // 7
//     54185, /* 102,401 */ // 8
// ];

let betLevel = [
    1000,
    1000,
    2111,
    4457,
    9409,
    19863,
    41933
];

// let betLevel = [
//     2000,
//     2000,
//     4222,
//     8913,
//     18817,
//     39724,
//     83862
// ];

const meron = 'meron';
const wala = 'wala';

let pinger;

let presentLevel = 0;
let isBetSubmitted = false;
let finalBetside = wala;
let isBetOnHigherRoi = true;

let matchIndex = 1;
let matchIndexMultiplier = 1;
let winCount = 0;
let lossCount = 0;
let lossStreak = 0;
let betLowRoiOverwrite = false;

let timer;
let timerIndex = 0;
let maxWaitTimes = 82;

let isDemoOnly = false;

let matchLogs = [];

function createWebSocketConnection(crfToken) {
    if (crfTokenValue === '') {
        crfTokenValue = crfToken;
    }
    if ('WebSocket' in window) {
        websocketConnect(crfToken);
    }
}

const tabsOnUpdated = {
    setTabId : function(tabId){
        chrome.storage.sync.set({'tabId' : tabId },
            function() {
                tab.id = tabId;
            });
    }
}
const websocketConnect = (crfToken) => {
    if (websocket === undefined) {
        console.log(`%c- Initializing -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');
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
            console.log(`%c- Connected -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');

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
            console.log('%cxxxxxxxxxxxxxxxxxxxxxxxx', 'font-weight: bold; color: #f00; font-size: 19px;');
            console.log('%cGame Over! No more funds', 'font-weight: bold; color: #f00; font-size: 19px;');
            console.log('%cxxxxxxxxxxxxxxxxxxxxxxxx', 'font-weight: bold; color: #f00; font-size: 19px;');
            clearInterval(pinger);
            websocket.close();

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
            const fightNumber = fightData.fight_number;

            // Fix issue whereas the betting is closed but bet is not yet submitted
            if (timerIndex > 0) {
                clearTimeout(timer);
                timerIndex = 0;
            }

            if (fightStatus === 'cancelled' && isOpenBet === false) {
                paymentSafe(false);
                // reverseBet();
                isBetSubmitted = false;
                return;
            }
            if (fightStatus === 'finished' && isOpenBet === false && isBetting === true) {

                const isWinner = winner === finalBetside;
                const isDraw = winner === 'draw';

                if (isBetSubmitted === true) {
                    matchIndex += 1;

                    if (isDraw) {
                        paymentSafe(isDraw);
                        reverseBet();
                        isBetSubmitted = false;
                        return;
                    } else {
                        if (isWinner) {
                            winCount += 1;
                            console.log('%cCongratulations!', 'font-weight: bold; color: green', `${winner} wins`);
                        } else {
                            lossCount += 1;
                            console.log('%cYou lose!', 'font-weight: bold; color: red', `${winner} wins`);
                        }
                    }
                }
                if (finalBetside === '' || isBetSubmitted === false) {
                    console.log(`No bets detected! ${winner} wins`);
                    isBetSubmitted = false;
                    return;
                }
                if (isBetSubmitted === true) {
                    const odds = (finalBetside === wala ? walaOdds : meronOdds);

                    if (isWinner) {
                        lossStreak = 0;
                        betLowRoiOverwrite = false;

                        setMatchLogs(fightNumber, isWinner, betLevel[presentLevel] * odds);

                        presentLevel = 0;
                    } else {
                        lossStreak += 1;

                        setMatchLogs(fightNumber, isWinner, parseInt(-(betLevel[presentLevel])));

                        presentLevel += 1;
                    }
                }

                isBetSubmitted = false;

                return;
            }
            if (fightStatus === 'on-going' && isOpenBet === false && isNewFight === false) {
                return;
            }
        }
        if (fightEvent === 'App\\Events\\BettingPosted' && isBetting === true) {
            if (isBetSubmitted === true) {
                return;
            }

            if (timerIndex === 0) {
                startTimer();
            }

            if (timerIndex <= maxWaitTimes) {
                return;
            }

            const multiplier = 7 * matchIndexMultiplier;
            const matchModulus = (matchIndex / 10) % 2;

            if (matchModulus === 0 || matchModulus === 1) {
                printProfit();
            }

            console.log('--------------------------');

            if (matchIndex >= multiplier && betLowRoiOverwrite === false) {
                if (lossCount >= winCount && (lossCount >= 5 || winCount >= 5)) {
                    console.log(`%cReversing... Loss is ${lossCount} but win is only ${winCount}`, 'font-weight: bold; color: #00ff00; font-size: 12px;');
                    reverseBet();
                    resetIndexCounter();

                    matchIndexMultiplier += 1;
                }
            }
            if (lossStreak >= 4 && betLowRoiOverwrite === false) {
                betLowRoiOverwrite = true;

                console.log(`%cAll bets for Low ROI! Succeeding lose streak was ${lossStreak}`, 'font-weight: bold; color: #00ff00; font-size: 12px;');
                resetIndexCounter();
            }

            stopTimer();

            setFinalBet(data[2]);

            chrome.tabs.sendMessage(tab.id, {text: "inputBet", bet: betLevel[presentLevel]});

            if (isDemoOnly === false) {
                await new Promise(resolve => setTimeout(resolve, 500));
                chrome.tabs.sendMessage(tab.id, {text: "placeBet", betSide: finalBetside});
            }

            if (isBetSubmitted === true) {
                return;
            }

            if (isDemoOnly === false) {
                await new Promise(resolve => setTimeout(resolve, 500));
                chrome.tabs.sendMessage(tab.id, {text: "submitBet"});
            }

            const livesRemaining = betLevel.length - presentLevel;

            console.log(`${livesRemaining} ${livesRemaining > 1 ? 'lives' : 'life'} remaining => ${betLevel[presentLevel]} pesos => %c${finalBetside} at ${isBetOnHigherRoi ? 'higher ROI ⤴' : 'lower ROI ⤵'}`, 'font-weight: bold; color: pink');

            isBetSubmitted = true;
        }
    }
    websocket.onclose = function () {
        if (reconnectRetries > 0) {
            return;
        }

        clearInterval(pinger);
        console.log(`%c- Interrupted -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');

        if (!(presentLevel > betLevel.length - 1)) {
            retryPinger = setInterval(function () {
                if (reconnectRetries >= 3) {
                    console.log('%c- Terminated -', 'font-weight: bold; color: #00ff00; font-size: 12px;');
                    websocket.close();
                    websocket = undefined;
                    clearInterval(retryPinger);
                    clearInterval(pinger);
                    return;
                }
                if (crfTokenValue !== '') {
                    console.log('%c- Reconnecting -', 'font-weight: bold; color: #00ff00; font-size: 12px;');
                    websocket = new WebSocket(wssUrl);
                    createWebSocketConnection(crfTokenValue);
                }
                reconnectRetries += 1;
            }, 12000);
        }
    };
}

function setMatchLogs(fightNumber, isWin, sum) {
    matchLogs.push({fightNumber, isWin, sum});
}
function startTimer() {
    timer = setInterval(function () {
        timerIndex += 1;
    }, 1000);
}
function resetIndexCounter() {
    lossCount = 0;
    winCount = 0;
}
function stopTimer() {
    clearTimeout(timer);
    timerIndex = 0;
}
function setFinalBet(fightData) {
    reverseBet();

    finalBetside = (isBetOnHigherRoi
        ? (fightData.meron_odds > fightData.wala_odds) : (fightData.meron_odds < fightData.wala_odds))
        ? meron : wala;
}
function reverseBet() {
    if (betLowRoiOverwrite === true) {
        isBetOnHigherRoi = false;
        return;
    }

    isBetOnHigherRoi = !isBetOnHigherRoi;
}
function paymentSafe(isDraw) {
    console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
}
function printProfit() {
    const winMatches = matchLogs.filter(c => c.isWin === true);
    const lossMatches = matchLogs.filter(c => c.isWin === false);

    console.log('--------------------------');
    console.log(`%cWin: ${winMatches.length} | Loss: ${lossMatches.length} | Total: ${matchLogs.length}`, 'font-weight: bold; color: yellow');
    console.log(`%cTotal Profit: Php ${parseInt(matchLogs.map(({sum}) => sum).reduce((a, b) => a + b, 0)).toLocaleString()}`, 'font-weight: bold; color: yellow');
}

chrome.tabs.onUpdated.addListener(function(tabId, info) {
    if (info.status === "complete") {
        tabsOnUpdated.setTabId(tabId);
    }
});
chrome.extension.onConnect.addListener(function(port) {
    port.onMessage.addListener(function (message) {
        if (port.name === 'getCrfToken') {
            chrome.tabs.sendMessage(tab.id, {text: "getCrfTokenRequest"},
                function (crfToken) {
                    createWebSocketConnection(crfToken);
                }
            );
        }
    });
});
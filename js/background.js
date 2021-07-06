let websocket;
let tab = { id : 0 };
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

let betLevel = [
    // 147,
    // 147,
    // 311,
    // 745,
    // 1684,
    // 3656,
    // 7818,
    // 10492,

    612, // 1
    612, // 2
    1292, // 3
    2728, // 4
    5759, // 5
    12158, /* 23,161 */ // 6
    // 25667, /* 48,216 */ // 7
    // 54185 /* 102,401 */
];

const meron = 'meron';
const wala = 'wala';

let pinger;

let presentLevel = 0;
let isBetSubmitted = false;
let finalBetside = wala;
let isBetOnHigherRoi = false;

let matchIndex = 1;
let matchIndexMultiplier = 1;
let winCount = 0;
let lossCount = 0;

let timer;
let timerIndex = 0;
let maxWaitTimes = 62;

let isDemoOnly = true;

function createWebSocketConnection(crfToken) {
    if('WebSocket' in window){
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
        console.log('Websocket initialized!')
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
            console.log('Websocket connected successfully!')
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
                    if (isDraw) {
                        paymentSafe(isDraw);
                        reverseBet();
                        isBetSubmitted = false;
                        return;
                    } else {
                        matchIndex += 1;

                        if (isWinner) {
                            winCount += 1;
                            console.log('%cCongratulations!', 'font-weight: bold; color: green', `${winner} wins`);
                        } else {
                            lossCount += 1;
                            console.log('%cYou lose!', 'font-weight: bold; color: red', 'Your bet is', `${finalBetside} but ${winner} wins`);
                        }
                    }
                }
                if (finalBetside === '' || isBetSubmitted === false) {
                    console.log(`No bets detected! ${winner} wins`);
                    isBetSubmitted = false;
                    return;
                }
                if (isBetSubmitted === true) {
                    if (isWinner) {
                        presentLevel = 0;
                    } else {
                        presentLevel += 1;
                    }
                }

                isBetSubmitted = false;
                printRemainingLives();

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

            if (matchIndex >= multiplier) {
                if (lossCount >= winCount) {
                    console.log(`%cReversing... Loss is ${lossCount} but win is only ${winCount}`, 'font-weight: bold; color: #00ff00; font-size: 23px;');
                    reverseBet();
                }

                resetIndexCounter();

                matchIndexMultiplier += 1;
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

            console.log('--------------------');
            console.log(`Match index: ${matchIndex} of ${multiplier - 1}`)
            console.log(`Betting for %c${finalBetside} with ${isBetOnHigherRoi ? 'higher ROI ⤴' : 'lower ROI ⤵'}`, 'font-weight: bold; color: pink');

            isBetSubmitted = true;
        }
    }
    websocket.onclose = function () {
        clearInterval(pinger);
        websocket.close();
        websocket = undefined;

        console.log(`%c**** Connection Closed ****`, 'font-weight: bold; color: #00ff00; font-size: 23px;');
    };
    pinger = setInterval(function () {
        try {
            websocket.send('2');
        } catch (e) {
        }
    }, 15000);
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
        ? (fightData.meron_odds > fightData.wala_odds)
        : (fightData.meron_odds < fightData.wala_odds))
        ? meron : wala;
}
function reverseBet() {
    isBetOnHigherRoi = !isBetOnHigherRoi;
}
function paymentSafe(isDraw) {
    console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
    printRemainingLives();
}
function printRemainingLives() {
    console.log(`${betLevel.length - presentLevel} of ${betLevel.length} lives remaining. Bets will be now at ${betLevel[presentLevel]} pesos.`);
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
var websocket;
let tab = { id : 0 };
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

const betLevel = [
    132,
    281,
    914,
    1775,
    3837,
    7686
];

let presentLevel = 0;
let previousOdds = 0;
let previousDiff = 0;
let diffTriggeredCount = 0;
let isBetSubmitted = false;
let betSide = '';
let isBetOnHigherRoi = false;
let lossStreakCount = 0;
let winStreakCount = 0;
let matchCompletedCount = 0;

const diffTriggeredSubmit = 9;

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

    websocket.onmessage = function (event) {
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
            console.log('Insufficient funds!');
            return;
        }

        if (fightEvent === 'App\\Events\\FightUpdate') {
            const fightData = data[2].data;
            const fightStatus = fightData.status;
            const winner = fightData.winner;
            const isOpenBet = fightData.open_bet === 'yes';
            const isNewFight = fightData.newFight === 'yes';

            if (fightStatus === 'cancelled' && isOpenBet === false) {
                paymentSafe();
                reverseBetIfAboveMatchCompletedThreshold();

                return;
            }
            if (fightStatus === 'finished' && isOpenBet === false && isBetting === true) {
                diffTriggeredCount = 0;
                previousOdds = 0;
                previousDiff = 0;

                const isWinner = winner === betSide;
                const isDraw = winner === 'draw';

                if (isBetSubmitted === true) {
                    if (isDraw) {
                        paymentSafe(isDraw);
                        isBetSubmitted = false;
                        return;
                    } else {
                        if (isWinner) {
                            console.log('%cCongratulations!', 'font-weight: bold; color: green', `${winner} wins`);
                        } else {
                            console.log('%cYou lose!', 'font-weight: bold; color: red', 'Your bet is', `${betSide} but ${winner} wins`);
                        }
                    }
                }

                reverseBetIfAboveMatchCompletedThreshold();

                if (betSide === '' || isBetSubmitted === false) {
                    console.log(`No bets detected! ${winner} wins`);
                    isBetSubmitted = false;
                    return;
                }
                if (isBetSubmitted === true) {
                    if (isWinner) {
                        presentLevel = 0;
                        winStreakCount = winStreakCount + 1;

                        reverseBetIfLosingStreak();
                    } else {
                        presentLevel = presentLevel + 1;
                        increaseLossStreak();
                    }
                }

                isBetSubmitted = false;
                printRemainingLives();

                // reverse betting
                if (winStreakCount > (isBetOnHigherRoi ? 2 : 3) && isWinner) {
                    reverseBet();
                }

                return;
            }
            if (fightStatus === 'on-going' && isOpenBet === false && isNewFight === false) {
                previousOdds = 0;

                return;
            }
        }
        if (fightEvent === 'App\\Events\\BettingPosted' && isBetting === true) {
            if (isBetSubmitted === true) {
                return;
            }

            const fightData = data[2];

            betSide = (isBetOnHigherRoi
                ? (fightData.meron_odds > fightData.wala_odds)
                : (fightData.meron_odds < fightData.wala_odds))
                ? 'meron' : 'wala';

            if (previousOdds > 0) {
                const calc = (fightData.meron_odds / previousOdds) * 100;
                const diff = calc > previousDiff ? calc - previousDiff : previousDiff - calc;
                previousDiff = calc;
                if (diff < 1.4) {
                    chrome.tabs.sendMessage(tab.id, {
                        text: "placeBet",
                        betSide: betSide
                    });
                    diffTriggeredCount++;
                }
            }

            previousOdds = fightData.meron_odds;
            chrome.tabs.sendMessage(tab.id, {text: "inputBet", bet: betLevel[presentLevel]});

            if (diffTriggeredCount >= diffTriggeredSubmit) {
                console.log('--------------------');
                console.log(`Betting for ${betSide}`);
                chrome.tabs.sendMessage(tab.id, {
                    text: "submitBet"
                });
                isBetSubmitted = true;
            }
        }
    }
    websocket.onclose = function () {
        websocket = undefined;
        console.log('Connection Closed!!!!');
    };
    setInterval(function () {
        try {
            websocket.send('2');
        } catch (e) {
        }
    }, 15000);
}

function reverseBet() {
    isBetOnHigherRoi = !isBetOnHigherRoi;
    console.log(`%c--==* Betting is now reversed! Now betting by ${isBetOnHigherRoi ? 'higher' : 'lower'} ROI *==--`, 'font-weight: bold; color: pink');

    lossStreakCount = 0;
    winStreakCount = 0;
    matchCompletedCount = 0;
}
function paymentSafe(isDraw) {
    console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
    printRemainingLives();
}
function printRemainingLives() {
    console.log(`${betLevel.length - presentLevel} of ${betLevel.length} lives remaining. Bets will be now at ${betLevel[presentLevel]} pesos. Good luck!`);
}
function increaseLossStreak() {
    lossStreakCount = lossStreakCount + 1;
}
function reverseBetIfLosingStreak() {
    if (lossStreakCount >= 3) {
        reverseBet();
    }

    lossStreakCount = 0;
}
function reverseBetIfAboveMatchCompletedThreshold() {
    matchCompletedCount = matchCompletedCount + 1;

    if (matchCompletedCount >= 4 && (lossStreakCount > 1 || winStreakCount > 1)) {
        reverseBet();
    }
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
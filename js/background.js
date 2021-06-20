let websocket;
let tab = { id : 0 };
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

const betLevel = [
    100,
    100,
    239,
    615,
    // 1299,
    // 2603,
    // 5495,
    // 11601,
    // 24491
];

let presentLevel = 0;
let previousOdds = 0;
let previousDiff = 0;
let diffTriggeredCount = 0;
let isBetSubmitted = false;
let betSide = '';
let hasPicked = false;
let lossStreakCount = 0;

const diffTriggeredSubmit = 2;

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

            hasPicked = false;

            if (fightStatus === 'cancelled' && isOpenBet === false) {
                paymentSafe();

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

                if (betSide === '' || isBetSubmitted === false) {
                    console.log(`No bets detected! ${winner} wins`);
                    isBetSubmitted = false;
                    return;
                }
                if (isBetSubmitted === true) {
                    if (isWinner) {
                        presentLevel = 0;

                        if (lossStreakCount >= 2) {

                        }
                    } else {
                        presentLevel = presentLevel + 1;
                        lossStreakCount = lossStreakCount + 1;


                    }
                }

                isBetSubmitted = false;
                printRemainingLives();

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

            betSide = randomPickBetSide();

            if (previousOdds > 0) {
                const calc = (fightData.meron_odds / previousOdds) * 100;
                const diff = calc > previousDiff ? calc - previousDiff : previousDiff - calc;
                previousDiff = calc;
                if (diff < 10) {
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
                console.log(`Betting for -%c${betSide}-`, 'font-weight: bold; color: pink');

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


function paymentSafe(isDraw) {
    console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
    printRemainingLives();
}
function printRemainingLives() {
    console.log(`${betLevel.length - presentLevel} of ${betLevel.length} lives remaining. Bets will be now at ${betLevel[presentLevel]} pesos. Good luck!`);
}
 function randomPickBetSide() {
     if (betSide === '') {
         hasPicked = false;
     }
     if (hasPicked === true) {
         return betSide;
     }

     hasPicked = true;

     const shuffleNames = (array) => {
         let oldElement;
         for (let i = array.length - 1; i > 0; i--) {
             let rand = Math.floor(Math.random() * (i + 1));
             oldElement = array[i];
             array[i] = array[rand];
             array[rand] = oldElement;
         }

         return array;
     }

     const meron = 'meron';
     const wala = 'wala';

     const shuffleIndex = shuffleNames([0, 1])[0];
     return shuffleNames([meron, wala])[shuffleIndex];
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
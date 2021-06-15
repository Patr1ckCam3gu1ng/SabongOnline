var websocket;
let tab = { id : 0 };
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

const betLevel = [
    281,
    633,
    1424
];
// const betLevel = [
//     281,
//     281,
//     281,
//     633,
//     1424,
//     3000,
//     5297,
//     7209,
//     // 16220
// ];

let presentLevel = 0;
let previousOdds = 0;
let previousDiff = 0;
let diffTriggeredCount = 0;
let isBetSubmitted = false;
let betSide = '';
let lossStreakCount = 0;
let isBetOnHigherRoi = true;

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
                return;
            }
            if (fightStatus === 'finished' && isOpenBet === false && isBetting === true) {
                diffTriggeredCount = 0;
                previousOdds = 0;
                previousDiff = 0;

                if (isBetSubmitted === true) {
                    if (winner === 'draw') {
                        console.log('Payment is safe! It\'s a draw');
                    } else {
                        if (betSide === winner) {
                            console.log('%cCongratulations!', 'font-weight: bold; color: green', `${winner} wins`);
                        } else {
                            console.log('%cYou lose!', 'font-weight: bold; color: red', 'Your bet is', `${betSide} but ${winner} wins`);
                        }
                    }
                }
                if (betSide === '' || isBetSubmitted === false) {
                    console.log('No bets detected');
                    isBetSubmitted = false;
                    return;
                }
                if (winner === 'draw') {
                    isBetSubmitted = false;
                    return;
                }
                if (winner === betSide) {
                    presentLevel = 0;
                } else {
                    if (isBetSubmitted === true) {
                        presentLevel = presentLevel + 1;
                        lossStreakCount = lossStreakCount + 1;
                    }
                }
                isBetSubmitted = false;
                console.log(`presentLevel starts at ${presentLevel}. Bets will be now at ${betLevel[presentLevel]} pesos. Good luck!`);
                console.log('--------------------');

                // reverse betting
                if (lossStreakCount > 5 && winner === betSide) {
                    isBetOnHigherRoi = !isBetOnHigherRoi;
                    lossStreakCount = 0;
                    console.log(`--==* Betting is now reversed! Now betting by ${isBetOnHigherRoi ? 'higher' : 'lower'} ROI *==--`)
                }
                if (lossStreakCount <= 5 && winner === betSide) {
                    lossStreakCount = 0;
                }

                return;
            }
            if (fightStatus === 'on-going' && isOpenBet === false && isNewFight === false) {
                previousOdds = 0;
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

            const diffTriggeredSubmit = 5;

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
                    if (diffTriggeredCount > diffTriggeredSubmit - 3) {
                        console.log('diffTriggeredCount', diffTriggeredCount)
                    }
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

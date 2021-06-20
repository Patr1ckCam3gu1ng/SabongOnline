let websocket;
let tab = { id : 0 };
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

const betLevel = [
    140
];

let presentLevel = 0;
let previousDiff = 0;
let isBetSubmitted = false;
let betSide = '';
let hasPicked = false;
let finalBetside = '';

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
                previousDiff = 0;

                const isWinner = winner === finalBetside;
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
                        presentLevel = presentLevel + 1;
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
            await new Promise(resolve => setTimeout(resolve, 8000));

            if (isBetSubmitted === true) {
                return;
            }

            finalBetside = '';
            finalBetside = betSide;

            finalBetside = '';
            finalBetside = betSide;

            await new Promise(resolve => setTimeout(resolve, 500));
            chrome.tabs.sendMessage(tab.id, {text: "inputBet", bet: betLevel[presentLevel]});

            await new Promise(resolve => setTimeout(resolve, 500));
            chrome.tabs.sendMessage(tab.id, {text: "placeBet", betSide: finalBetside});

            await new Promise(resolve => setTimeout(resolve, 3000));

            if (isBetSubmitted === true) {
                return;
            }

            chrome.tabs.sendMessage(tab.id, {text: "submitBet"});

            console.log('--------------------');
            console.log(`Betting for -%c${finalBetside}-`, 'font-weight: bold; color: pink');

            hasPicked = true;
            isBetSubmitted = true;
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

    setInterval(async function () {
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

        betSide = shuffleNames([meron, wala])[0];
    }, 100);
}


function paymentSafe(isDraw) {
    console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
    printRemainingLives();
}
function printRemainingLives() {
    console.log(`${betLevel.length - presentLevel} of ${betLevel.length} lives remaining. Bets will be now at ${betLevel[presentLevel]} pesos. Good luck!`);
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
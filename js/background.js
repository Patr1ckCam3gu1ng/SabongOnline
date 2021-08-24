let websocket;
let tab = { id: 0 };
let crfTokenValue = '';
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

let reconnectRetries = 0;
let retryPinger;

// let betLevel = [
//     612,    // 1
//     612,    // 2
//     1292,   // 3
//     2728,   // 4
//     5759,   // 5
//     12158,  // 6
//     25667   // 7
// ];

let betLevel = [
    1300,   // 1
    1300,   // 2
    2744,   // 3
    5793,   // 4
    12230,  // 5
    25819,  // 6
    54507,  // 7
];

// let betLevel = [
//     6000,   // 1
//     6000,   // 2
//     12667,  // 3
//     26741,  // 4
//     56453,  // 5
//     119179, // 6
//     251600  // 7
// ];

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

let matchIndex = 1;
let winCount = 0;
let lossCount = 0;
let drawCount = 0;
let lossStreak = 0;
let winStreak = 0;
let isShuffleBetSide = false;
let isShuffleBetSideHasPicked = false;
let highestLossStreak = 0;
let highestWinStreak = 0;
let betAmountPlaced = 0;
let isBettingWithAccumulatedAmount = false;
let isBetFromTakenProfit = false;
let isBelowMinimumOdds = false;
let isAboveMaximumOdds = false;
let matchOdds = 0;
let isReminded = false;
let isWinner = false;
let ignoreRaceTime = false;
let printRaceTime = '';
let isFlushed = false;

let dailyProfitQuotaLimit = 6000;

let timer;
let timerIndex = 0;

const oddsMinimum = 175;
const oddsMaximum = 215;

//should remain 'let' so we can change it in the console:
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
    setTabId: function (tabId) {
        chrome.storage.sync.set({ 'tabId': tabId },
            function () {
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

            setLocalVariablesFromCache();

            return;
        }
        if (event.data.substr(0, 2) === '0{') {
            return;
        }
        const data = JSON.parse(event.data.substr(2, event.data.length - 1));

        if (data.length === 0) {
            return;
        }

        let isWithinAllottedRaceTime = false;

        if (isWithinAllottedRacetime('10:00:00 AM', '12:45:00 PM') ||
            isWithinAllottedRacetime('03:00:00 PM', '05:45:00 PM') ||
            (isWithinAllottedRacetime('11:00:00 PM', '11:59:59 PM') || isWithinAllottedRacetime('12:00:00 AM', '02:45:00 AM')) ||
            isWithinAllottedRacetime('04:00:00 AM', '07:45:00 AM')) {

            isWithinAllottedRaceTime = true;

            isReminded = false;
            isFlushed = false;

            // if (isFlushed === false) {
            //     flushMatchLogs();
            //     isFlushed = true;
            // }
        }
        else {

            isQuotaReachedPrinted = false;

            if (isFlushed === false) {
                flushMatchLogs();
                isFlushed = true;
            }
        }

        if (isWithinAllottedRaceTime === false && ignoreRaceTime === false) {
            if (isReminded === false) {
                console.log(`%c- Race not allowed yet. Be back at later! -`, 'font-weight: bold; color: #f00;');

                isReminded = true;
            }

            return;
        }

        const fightEvent = data[ 0 ];
        const isBetting = data[ 1 ] === 'betting';

        if (isDailyQuotaReached() === true) {
            if (isQuotaReachedPrinted === false) {
                printProfit();

                printLine();

                console.log(`%c\\( ﾟヮﾟ)/ Job Well Done! Quota reached: Php ${calculateTodaysProfit().totalNetProfit.toLocaleString()} ✯⸜(*❛‿❛)⸝✯`, 'font-weight: bold; color: #FF00FF; font-size: 15px;');

                isQuotaReachedPrinted = true;
            }

            // clearInterval(pinger);
            // clearInterval(retryPinger);
            // websocket.close();

            return;
        }

        if (presentLevel > betLevel.length - 1) {
            console.log('%cxxxxxxxxxxxxxxxxxxxxxxxx', 'font-weight: bold; color: #f00; font-size: 19px;');
            console.log('%cGame Over! No more funds', 'font-weight: bold; color: #f00; font-size: 19px;');
            console.log('%cxxxxxxxxxxxxxxxxxxxxxxxx', 'font-weight: bold; color: #f00; font-size: 19px;');
            clearInterval(pinger);
            websocket.close();

            return;
        }

        if (fightEvent === 'App\\Events\\ArenaUpdate') {
            const fightData = data[ 2 ].data;
            const event = fightData.event;

            return;
        }
        if (fightEvent === 'App\\Events\\FightUpdate') {
            const fightData = data[ 2 ].data;
            const fightStatus = fightData.status;
            const winner = fightData.winner;
            const isOpenBet = fightData.open_bet === 'yes';
            const isNewFight = fightData.newFight === 'yes';
            const isWaitingDecision = fightData.waiting_decision === 'yes';
            const meronOdds = fightData.meron_equalpoint;
            const walaOdds = fightData.wala_equalpoint;
            const fightNumber = fightData.fight_number;

            if (isOpenBet === false && isWaitingDecision === true && fightStatus === 'on-going' && isBetSubmitted === false && (timerIndex - 1) < maxWaitTimes && fightStatus !== 'cancelled') {
                printLine();
                console.log(`%cBet not submitted. Timer was only ${timerIndex} whilst max wait time is ${maxWaitTimes}`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
            }

            // Fix issue whereas the betting is closed but bet is not yet submitted
            if (timerIndex > 0) {
                clearTimeout(timer);
                timerIndex = 0;
            }

            isShuffleBetSideHasPicked = false;

            if (isOpenBet === false && isWaitingDecision === true && fightStatus === 'on-going' && isBetSubmitted === false && isBelowMinimumOdds === true) {
                console.log(`%cSkipping Match! Odds too low: ${finalBetside} => ${matchOdds} ⤵`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
                return;
            }
            if (isOpenBet === false && isWaitingDecision === true && fightStatus === 'on-going' && isBetSubmitted === false && isAboveMaximumOdds === true) {
                console.log(`%cSkipping Match! Odds too high: ${finalBetside} => ${matchOdds} ⤴`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
                return;
            }

            if (fightStatus === 'cancelled' && isOpenBet === false) {
                paymentSafe(false);
                reverseBet();

                isBetSubmitted = false
                return;
            }
            if (fightStatus === 'finished' && isOpenBet === false && isBetting === true) {
                matchIndex += 1;

                isWinner = winner === finalBetside;

                const isDraw = winner === 'draw';
                let isBetFromProfitUsedAlready = false;

                if (isBetSubmitted === true) {
                    chrome.storage.local.set({ matchIndex });

                    if (isDraw) {
                        paymentSafe(isDraw);
                        reverseBet();
                        isBetSubmitted = false;
                        isBelowMinimumOdds = false;
                        isAboveMaximumOdds = false;

                        drawCount += 1;

                        chrome.storage.local.set({ drawCount });
                        return;
                    } else {
                        if (isWinner) {
                            winCount += 1;
                            console.log('%cCongratulations!', 'font-weight: bold; color: green', `${winner} wins`);
                        } else {
                            lossCount += 1;
                            console.log('%cYou lose!', 'font-weight: bold; color: red', `${winner} wins`);
                        }

                        chrome.storage.local.set({ winCount });
                        chrome.storage.local.set({ lossCount });
                    }
                } else {
                    if (isBelowMinimumOdds === true || isAboveMaximumOdds === true) {
                        console.log(`%c${winner === 'draw' ? 'It\'s a draw!' : `${winner} wins`}`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
                    }
                }
                if (finalBetside === '' || isBetSubmitted === false) {
                    isBetSubmitted = false;
                    isBelowMinimumOdds = false;
                    isAboveMaximumOdds = false;
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

                        lossStreak = 0;
                        isShuffleBetSide = false;

                        chrome.storage.local.set({ isShuffleBetSide });

                        setMatchLogs(fightNumber, isWinner, winningSum, betAmountPlaced);

                        if (winStreak > highestWinStreak) {
                            highestWinStreak = winStreak;
                            chrome.storage.local.set({ highestWinStreak });
                        }
                        chrome.storage.local.set({ winStreak });
                        chrome.storage.local.set({ lossStreak });

                        isMatchWin = isWinner;
                        presentLevel = 0;

                        console.log('%cProfit:', 'font-weight: bold; color: green', `+${winningSum.toFixed(2)} => ${((odds * 100) - 100).toFixed(0)}%`);
                    } else {
                        lossStreak += 1;

                        winStreak = 0;

                        setMatchLogs(fightNumber, isWinner, -betAmountPlaced, betAmountPlaced);

                        if (lossStreak > highestLossStreak) {
                            if (isBettingWithAccumulatedAmount === false && isBetFromTakenProfit === false) {
                                highestLossStreak = lossStreak;
                                chrome.storage.local.set({ highestLossStreak });
                            }
                        }
                        chrome.storage.local.set({ winStreak });
                        chrome.storage.local.set({ lossStreak });

                        presentLevel += 1;

                        if (isBettingWithAccumulatedAmount === true) {
                            presentLevel -= 1;
                        } else if (isBetFromTakenProfit === true) {
                            // presentLevel -= 1;
                            isBetFromProfitUsedAlready = true;
                        }
                    }

                    isBetFromTakenProfit = false;

                    if (isBettingWithAccumulatedAmount === true) {
                        isBettingWithAccumulatedAmount = !isBettingWithAccumulatedAmount;
                    }
                    // if (isWinner === false) {
                    //     const { profit } = calculateProfit();
                    //
                    //     if (profit > betLevel[ 0 ] && presentLevel === 2 && isBetFromProfitUsedAlready === false) {
                    //         isBetFromTakenProfit = true;
                    //     }
                    // }

                    isBetFromProfitUsedAlready = false;

                    chrome.storage.local.set({ presentLevel });
                }

                isBetSubmitted = false;
                betAmountPlaced = 0;
                isBelowMinimumOdds = false;
                isAboveMaximumOdds = false;

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

            if ([0, 1].includes((matchIndex / 10) % 2) && isBelowMinimumOdds === false && isAboveMaximumOdds === false) {
                isPendingPrintProfit = true;
            }
            if (isMatchWin === true && isPendingPrintProfit === true && isBelowMinimumOdds === false && isAboveMaximumOdds === false) {
                isPendingPrintProfit = false;

                printProfit();
            }

            if ([0, 1].includes(matchIndex / 8 % 2) && isShuffleBetSide === false && isBelowMinimumOdds === false && isAboveMaximumOdds === false) {
                printLine();
                resetIndexCounter();
            } else {
                if (isBelowMinimumOdds === false && isAboveMaximumOdds === false) {
                    printLine();
                }
            }

            if (lossStreak >= 3 && isShuffleBetSide === false && isBelowMinimumOdds === false && isAboveMaximumOdds === false) {
                isShuffleBetSide = true;
            }

            const dataBetOdds = { value: data[ 2 ] };
            const clonedDataBetOdds = { ...dataBetOdds };

            setFinalBet(clonedDataBetOdds.value);

            if (isBetOddsIrregular(clonedDataBetOdds)) {
                return;
            }

            stopTimer();

            let bet = betLevel[ presentLevel ];

            if (isBetFromTakenProfit === true) {
                bet = betLevel[ 0 ];
            }

            if (winStreak > 1 && presentLevel === 0 && isMatchWin === true) {
                isBettingWithAccumulatedAmount = true;
            }

            betAmountPlaced = parseInt(bet);

            chrome.tabs.sendMessage(tab.id, { text: "inputBet", bet });

            if (isDemoOnly === false) {
                await new Promise(resolve => setTimeout(resolve, 500));
                chrome.tabs.sendMessage(tab.id, { text: "placeBet", betSide: finalBetside });
            }

            if (isBetSubmitted === true) {
                return;
            }

            if (isDemoOnly === false) {
                await new Promise(resolve => setTimeout(resolve, 500));
                chrome.tabs.sendMessage(tab.id, { text: "submitBet" });
            }

            const { grossProfit } = calculateProfit();
            const hasProfitForBetting = (grossProfit - (isBettingWithAccumulatedAmount ? betLevel[ 0 ] : 0)) > betLevel[ 0 ];

            let livesRemaining = betLevel.length - presentLevel

            if (isBettingWithAccumulatedAmount === true) {
                livesRemaining += 1;
            }
            if (presentLevel < 2 && hasProfitForBetting === true) {
                // livesRemaining += 1;
            }
            // if (presentLevel === 2 && isBetFromTakenProfit === true) {
            //     livesRemaining += 1;
            // }

            console.log(`${livesRemaining} ${livesRemaining > 1 ? 'lives' : 'life'} remaining => ${betAmountPlaced}${isBettingWithAccumulatedAmount ? '(A)' : ''}${isBetFromTakenProfit ? '(P)' : ''} pesos => %c${finalBetside}${isShuffleBetSide ? ' (shuffled)' : ''} at ${isBetOnHigherRoi ? `higher ROI ⤴` : `lower ROI ⤵`}`,
                'font-weight: bold; color: pink');

            isBetSubmitted = true;
        }
    }
    websocket.onclose = function () {
        if (reconnectRetries > 0) {
            return;
        }

        clearInterval(pinger);
        console.log(`%c- Interrupted -`, 'font-weight: bold; color: #00ff00; font-size: 12px;');

        if (!(presentLevel > betLevel.length - 1) && isDailyQuotaReached() === false) {
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
                    console.log('%c- Reconnecting -', 'font-weight: bold; color: #00ff00; font-size: 12px;');
                    websocket = new WebSocket(wssUrl);
                    createWebSocketConnection(crfTokenValue);
                }
                reconnectRetries += 1;
            }, 12000);
        }
    };
}

function setLocalVariablesFromCache() {
    chrome.storage.local.get(['finalBetside'], function (result) {
        if (Object.keys(result).length === 0) {
            finalBetside = '';
            return;
        }
        finalBetside = result.finalBetside;
    });
    chrome.storage.local.get(['matchIndex'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        matchIndex = result.matchIndex;
    });
    chrome.storage.local.get(['winStreak'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        winStreak = result.winStreak;
    });
    chrome.storage.local.get(['lossStreak'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        lossStreak = result.lossStreak;
    });
    chrome.storage.local.get(['matchLogs'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        matchLogs = [];
        matchLogs = result.matchLogs;
    });
    chrome.storage.local.get(['highestLossStreak'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        highestLossStreak = result.highestLossStreak;
    });
    chrome.storage.local.get(['highestWinStreak'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        highestWinStreak = result.highestWinStreak;
    });
    chrome.storage.local.get(['presentLevel'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        presentLevel = result.presentLevel;
    });
    chrome.storage.local.get(['winCount'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        winCount = result.winCount;
    });
    chrome.storage.local.get(['lossCount'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        lossCount = result.lossCount;
    });
    chrome.storage.local.get(['isBetOnHigherRoi'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        isBetOnHigherRoi = result.isBetOnHigherRoi;
    });
    chrome.storage.local.get(['isShuffleBetSide'], function (result) {
        if (Object.keys(result).length === 0) {
            return;
        }
        isShuffleBetSide = result.isShuffleBetSide;
    });
}

function setMatchLogs(fightNumber, isWin, sum, betAmountPlaced) {
    matchLogs.push({ fightNumber, isWin, sum, betAmountPlaced });
    chrome.storage.local.set({ matchLogs });
}

function startTimer() {
    timer = setInterval(function () {
        timerIndex += 1;
    }, 1000);
}

function resetIndexCounter() {
    lossCount = 0;
    winCount = 0;
    drawCount = 0;

    chrome.storage.local.set({ lossCount });
    chrome.storage.local.set({ winCount });
    chrome.storage.local.set({ drawCount });
}

function stopTimer() {
    clearTimeout(timer);
    timerIndex = 0;
}

function isBetOddsIrregular(clonedDataBetOdds) {
    const { meron_odds, wala_odds } = clonedDataBetOdds.value;

    matchOdds = finalBetside === meron ? meron_odds : wala_odds;

    if (oddsMinimum > matchOdds && finalBetside !== '' && lossStreak >= 1) {
        isBelowMinimumOdds = true;
        return true;
    }
    if (matchOdds > oddsMaximum && finalBetside !== '') {
        isAboveMaximumOdds = true;
        return true;
    }

    return false;
}

 function setFinalBet(fightData) {
     if (isShuffleBetSide === true && isShuffleBetSideHasPicked === true) {
         return;
     }
     if (isBelowMinimumOdds === false && isAboveMaximumOdds === false) {
         reverseBet();
     }
     if (finalBetside === '') {
         isBetOnHigherRoi = false;
     }
     if (isShuffleBetSide === true) {
         const shuffleBetSideResult = shuffleBetSide();

         finalBetside = (shuffleBetSideResult
             ? (fightData.meron_odds > fightData.wala_odds) : (fightData.meron_odds < fightData.wala_odds))
             ? meron : wala;

         if (finalBetside === meron) {
             isBetOnHigherRoi = fightData.meron_odds > fightData.wala_odds;
         }
         if (finalBetside === wala) {
             isBetOnHigherRoi = fightData.wala_odds > fightData.meron_odds;
         }

         isShuffleBetSideHasPicked = true;
     } else {
         finalBetside = (isBetOnHigherRoi
             ? (fightData.meron_odds > fightData.wala_odds) : (fightData.meron_odds < fightData.wala_odds))
             ? meron : wala;
     }

     chrome.storage.local.set({ finalBetside });
     chrome.storage.local.set({ isBetOnHigherRoi });
 }

function reverseBet() {
    isBetOnHigherRoi = !isBetOnHigherRoi;
}

function paymentSafe(isDraw) {
    if (isDraw === false && isBetSubmitted === false) {
        printLine();
    }
    console.log('%cPayment is safe!', 'font-weight: bold; color: yellow', isDraw ? 'It\'s a draw' : 'Game cancelled');
}

function printProfit() {
    const { grossProfit, wonMatches, lossMatches, todaysTotalNetProfit, todaysAverageProfit, todaysAverageProfitPercentage } = calculateProfit();
    const totalMatches = [...matchLogs].slice(1);

    printLine();

    console.log(`%cWin: ${wonMatches} | Loss: ${lossMatches} | Total Matches: ${totalMatches.length}`, 'font-weight: bold; color: yellow');
    console.log(`%cWin Streak: ${highestWinStreak} | Loss Streak: ${highestLossStreak}`, 'font-weight: bold; color: yellow');
    console.log(`%c---`, 'font-weight: bold; color: yellow');
    console.log(`%cToday's Profit: Php ${todaysTotalNetProfit.toLocaleString()} | Today's Average Profit: Php ${parseInt(todaysAverageProfit).toLocaleString()} ${`(${todaysAverageProfitPercentage}%)`}`, 'font-weight: bold; color: yellow');
    console.log(`%c---`, 'font-weight: bold; color: yellow');
    console.log(`%cTotal Profit: Php ${grossProfit.toLocaleString()}`, 'font-weight: bold; color: yellow');
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

    let shuffledTrueFalse;
    let shuffledIndex;

    let index = 0;

    while (index < (Math.floor(parseInt(((Math.random() * 500) + 1).toFixed(0))))) {
        shuffledTrueFalse = shuffleArrays([true, false]);
        index++;
    }

    index = 0;

    while (index < (Math.floor(parseInt(((Math.random() * 500) + 1).toFixed(0))))) {
        shuffledIndex = parseInt(shuffleArrays([0, 1]));
        index++;
    }

    return !shuffledTrueFalse[ shuffledIndex ];
}

function printLine() {
    console.log('%c-', 'color: black;');
}

function isMorningRace() {
    const now = new Date();
    const earliestRaceTime = '10:00:00 AM';

    const result = (new Date(now.getTime()) > new Date(now.toLocaleDateString() + " " + earliestRaceTime).getTime() &&
        new Date(now.getTime()) < new Date(now.toLocaleDateString() + " " + "11:59:00 AM").getTime());

    if (result === false) {
        printRaceTime = earliestRaceTime;
    }

    return result;
}

function isWithinAllottedRacetime(startTime, endTime) {
    const now = new Date();

    const result = (new Date(now.getTime()) > new Date(now.toLocaleDateString() + " " + startTime).getTime() &&
        new Date(now.getTime()) < new Date(now.toLocaleDateString() + " " + endTime).getTime());

    if (result === false) {
        printRaceTime = startTime;
    }

    return result;
}

function calculateProfit() {
    const wonMatches = matchLogs.filter(c => c.isWin === true);
    const lossMatches = matchLogs.filter(c => c.isWin === false);

    const grossProfit = parseInt(matchLogs.map(({ sum }) => sum).reduce((a, b) => a + b, 0));
    const { totalNetProfit: todaysTotalNetProfit, averageProfit: todaysAverageProfit, averageProfitPercentage: todaysAverageProfitPercentage } = calculateTodaysProfit();

    return {
        wonMatches: wonMatches.length,
        lossMatches: lossMatches.length,
        //
        grossProfit: grossProfit,
        //
        todaysTotalNetProfit,
        todaysAverageProfit,
        todaysAverageProfitPercentage
    }
}

function calculateTodaysProfit() {
    const wonMatches = [...matchLogs].slice(1).filter(c => c.isWin === true);
    const lossMatches = [...matchLogs].slice(1).filter(c => c.isWin === false);

    const wonMatchesTotalGrossProfit = parseInt(wonMatches.map(({ sum }) => sum).reduce((a, b) => a + b, 0));
    const lossMatchesTotalGrossProfit = parseInt(lossMatches.map(({ sum }) => sum).reduce((a, b) => a + b, 0));

    const averageProfit = (wonMatchesTotalGrossProfit / wonMatches.length).toFixed(0).toLocaleString();

    return {
        totalNetProfit: wonMatchesTotalGrossProfit + lossMatchesTotalGrossProfit,
        averageProfit: averageProfit,
        averageProfitPercentage: ((averageProfit / parseInt(betLevel[ 0 ])) * 100).toFixed(0)
    }
}

function isDailyQuotaReached() {
    const { totalNetProfit } = calculateTodaysProfit();

    return totalNetProfit >= dailyProfitQuotaLimit;
}

function flushMatchLogs() {
    const { totalNetProfit } = calculateTodaysProfit();

    const sum = totalNetProfit;

    chrome.storage.local.clear();

    matchLogs = [];
    matchLogs.push(
        { fightNumber: 2, isWin: true, sum, betAmountPlaced: 0 });
}

chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.status === "complete") {
        tabsOnUpdated.setTabId(tabId);
    }
});
chrome.extension.onConnect.addListener(function (port) {
    port.onMessage.addListener(function (message) {
        if (port.name === 'getCrfToken') {
            chrome.tabs.sendMessage(tab.id, { text: "getCrfTokenRequest" },
                function (crfToken) {
                    createWebSocketConnection(crfToken);
                }
            );
        }
    });
});
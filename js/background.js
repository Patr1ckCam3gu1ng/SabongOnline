let websocket;
let tab = { id: 0 };
let crfTokenValue = '';
const wssUrl = 'wss://echo.wpc2022.live/socket.io/?EIO=3&transport=websocket';

let reconnectRetries = 0;
let retryPinger;

let betLevel = [
    135,
    135,
    315,
    735,
    1715,
    4001,
    9335,
    21781,
    50822
];

let dailyProfitQuotaLimit = betLevel[0] * 8;

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
let lossStreak = 0;
let winStreak = 0;
let isShuffleBetSide = false;
let isShuffleBetSideHasPicked = false;
let highestLossStreak = 0;
let highestWinStreak = 0;
let betAmountPlaced = 0;
let isBettingWithAccumulatedAmount = false;
let isBelowMinimumOdds = false;
let isAboveMaximumOdds = false;
let matchOdds = 0;
let isReminded = false;
let isWinner = false;
let ignoreRaceTime = false;

let timer;
let timerIndex = 0;

const oddsMinimum = 170
const oddsMaximum = 260;

//should remain 'let' so we can change it in the console:
let maxWaitTimes = 72;

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

let isPrintedNowCommencingScheduled = false;
let startTimelapse = 0;

let nextRaceTimeStarts = 0;

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
        websocket.send(`42${ JSON.stringify(subscriptionBody) }`);
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

        let isWithinAllottedRaceTime = false;

        if (isWithinAllottedRacetime()) {
            toggledVariablesWhenCommencedShift();
        }

        if (isWithinAllottedRaceTime === false && ignoreRaceTime === false) {
            if (isReminded === false) {
                printLine();
                console.log(`%c- Race not allowed yet. Be back later! -`, 'font-weight: bold; color: #f00;');
                isReminded = true;
            }

            return;
        }

        const fightEvent = data[0];
        const isBetting = data[1] === 'betting';

        if (isDailyQuotaReached() === true) {
            if (isQuotaReachedPrinted === false) {
                printProfit();
                printLine();

                const totalTimelapse = millisecondsConverter(window.performance.now() - startTimelapse);
                console.log(`%c( Timelapse: ${ totalTimelapse } )`, 'font-weight: bold; color: yellow');

                printLine();
                console.log(`%c\\( ﾟヮﾟ)/ Job Well Done! Quota reached: Php ${ calculateTodaysProfit().totalNetProfit.toLocaleString() } ✯⸜(*❛‿❛)⸝✯`, 'font-weight: bold; color: #FF00FF; font-size: 15px;');

                isQuotaReachedPrinted = true;
                isPrintedNowCommencingScheduled = false;

                flushPreviousVariance();

                stopTimer();

                // Next match at the next hour
                nextRaceTimeStarts = new Date(new Date().setMinutes(new Date().getMinutes() + randomInt()));

                printLine();
                console.log(`%cNext race time slated on ${ nextRaceTimeStarts.toLocaleString() }`, 'font-weight: bold; color: #FF00FF');
            }

            return;
        }

        isReminded = false;

        if (presentLevel > betLevel.length - 1) {
            printLine();

            console.log('%cGame Over! No more funds', 'font-weight: bold; color: #f00; font-size: 19px;');

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
            const isWaitingDecision = fightData.waiting_decision === 'yes';
            const meronOdds = fightData.meron_equalpoint;
            const walaOdds = fightData.wala_equalpoint;
            const fightNumber = fightData.fight_number;

            if (isOpenBet === false && isWaitingDecision === true && fightStatus === 'on-going' && isBetSubmitted === false && (timerIndex - 1) < maxWaitTimes && fightStatus !== 'cancelled') {
                printLine();
                console.log(`%cBet not submitted. Timer was only ${ timerIndex } whilst max wait time is ${ maxWaitTimes }`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
            }

            // Fix issue whereas the betting is closed but bet is not yet submitted
            if (timerIndex > 0) {
                clearTimeout(timer);
                timerIndex = 0;
            }

            isShuffleBetSideHasPicked = false;

            if (isOpenBet === false && isWaitingDecision === true && fightStatus === 'on-going' && isBetSubmitted === false && isBelowMinimumOdds === true) {
                console.log(`%cSkipping Match! Odds too low: ${ finalBetside } => ${ matchOdds } ⤵`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
                return;
            }
            if (isOpenBet === false && isWaitingDecision === true && fightStatus === 'on-going' && isBetSubmitted === false && isAboveMaximumOdds === true) {
                console.log(`%cSkipping Match! Odds too high: ${ finalBetside } => ${ matchOdds } ⤴`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
                return;
            }

            if (fightStatus === 'cancelled' && isOpenBet === false) {
                // printLine();
                paymentSafe(false);
                reverseBet();

                isBetSubmitted = false
                return;
            }
            if (fightStatus === 'finished' && isOpenBet === false && isBetting === true) {
                matchIndex += 1;

                isWinner = winner === finalBetside;

                const isDraw = winner === 'draw';

                if (isBetSubmitted === true) {
                    if (isDraw) {
                        paymentSafe(isDraw);
                        isBetSubmitted = false;
                        isBelowMinimumOdds = false;
                        isAboveMaximumOdds = false;

                        drawCount += 1;
                        return;
                    } else {
                        if (isWinner) {
                            winCount += 1;
                            console.log('%cCongratulations!', 'font-weight: bold; color: green', `${ winner } wins`);
                        } else {
                            lossCount += 1;
                            console.log('%cYou lose!', 'font-weight: bold; color: red', `${ winner } wins`);
                        }
                    }
                } else {
                    if (isBelowMinimumOdds === true || isAboveMaximumOdds === true) {
                        console.log(`%c${ winner === 'draw' ? 'It\'s a draw!' : `${ winner } wins` }`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
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

                        setMatchLogs(fightNumber, isWinner, winningSum, betAmountPlaced, odds);

                        if (winStreak > highestWinStreak) {
                            highestWinStreak = winStreak;
                        }

                        isMatchWin = isWinner;
                        presentLevel = 0;

                        console.log('%cProfit:', 'font-weight: bold; color: green', `+${ winningSum.toFixed(2) } => ${ ((odds * 100) - 100).toFixed(0) }%`);

                        reverseBetIfNeeded();
                    } else {
                        lossStreak += 1;

                        winStreak = 0;

                        setMatchLogs(fightNumber, isWinner, -betAmountPlaced, betAmountPlaced);

                        if (lossStreak > highestLossStreak) {
                            if (isBettingWithAccumulatedAmount === false) {
                                highestLossStreak = lossStreak;
                            }
                        }

                        presentLevel += 1;

                        if (isBettingWithAccumulatedAmount === true) {
                            presentLevel -= 1;
                        }

                        totalLossCountByFar += 1;
                    }

                    if (isBettingWithAccumulatedAmount === true) {
                        isBettingWithAccumulatedAmount = !isBettingWithAccumulatedAmount;
                    }
                }

                isBetSubmitted = false;
                betAmountPlaced = 0;
                isBelowMinimumOdds = false;
                isAboveMaximumOdds = false;
                isExtendedBet = false;

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

            // if (lossStreak >= 3 && isShuffleBetSide === false && isBelowMinimumOdds === false && isAboveMaximumOdds === false) {
            //     isShuffleBetSide = true;
            // }

            const dataBetOdds = { value: data[2] };
            const clonedDataBetOdds = { ...dataBetOdds };

            setFinalBet(clonedDataBetOdds.value);

            if (isBetOddsIrregular(clonedDataBetOdds)) {
                return;
            }

            stopTimer();

            let bet = betLevel[presentLevel];

            const extendedBetAmount = extendBetAmount(bet);
            const { updatedBet, addOnCapital } = overwriteOddsIfNeeded(bet, clonedDataBetOdds);

            if (extendedBetAmount !== bet) {
                isExtendedBet = true;
                bet = extendedBetAmount;
            } else {
                bet = updatedBet;
            }

            if (winStreak > 1 && presentLevel === 0 && isMatchWin === true) {
                isBettingWithAccumulatedAmount = true;
            }

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
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            chrome.tabs.sendMessage(tab.id, { text: "submitBet" });

            let livesRemaining = betLevel.length - presentLevel

            if (isBettingWithAccumulatedAmount === true) {
                livesRemaining += 1;
            }

            console.log(`${ livesRemaining } ${ livesRemaining > 1 ? 'lives' : 'life' } remaining => ${ betAmountPlaced }${ isBettingWithAccumulatedAmount ? '(A)' : '' }${ isExtendedBet ? '(E)' : `${ addOnCapital > 0 ? '(O)' : '' }` } pesos => %c${ finalBetside }${ isShuffleBetSide ? ' (shuffled)' : '' } at ${ isBetOnHigherRoi ? `higher ROI ⤴` : `lower ROI ⤵` }`, 'font-weight: bold; color: pink');

            await new Promise(resolve => setTimeout(resolve, 700));

            if (isDemoOnly === true) {
                isBetSubmitted = true;
            } else {
                chrome.tabs.sendMessage(tab.id, { text: "submittedBetValue", betSide: finalBetside },
                    async function (submittedBetValue) {
                        isBetSubmitted = submittedBetValue > 0;
                    }
                );
            }
        }

        function toggledVariablesWhenCommencedShift() {
            isWithinAllottedRaceTime = true;
            isQuotaReachedPrinted = false;
            printCommencedShift();

            if (isPrintedNowCommencingScheduled === true) {
                return;
            }

            timerIndex += 12;
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
                    console.log(`%c- Terminated on ${ localTime } -`, 'font-weight: bold; color: red; font-size: 12px;');

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

function setMatchLogs(fightNumber, isWin, sum, betAmountPlaced, odds) {
    matchLogs.push({ fightNumber, isWin, sum, betAmountPlaced, odds, isExtendedBet });
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
        // if (matchIndex % 2 === 0) {
        reverseBet();
        // }
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
    const {
        grossProfit,
        wonMatches,
        lossMatches,
        todaysTotalNetProfit
    } = calculateProfit();
    const totalMatches = [...matchLogs].slice(1);

    printLine();

    console.log(`%cWin: ${ wonMatches } | Loss: ${ lossMatches } | Total Matches: ${ totalMatches.length }`, 'font-weight: bold; color: yellow');
    console.log(`%cWin Streak: ${ highestWinStreak } | Loss Streak: ${ highestLossStreak }`, 'font-weight: bold; color: yellow');
    console.log(`%c---`, 'font-weight: bold; color: yellow');
    console.log(`%cToday's Profit: Php ${ todaysTotalNetProfit.toLocaleString() }`, 'font-weight: bold; color: yellow');
    console.log(`%c---`, 'font-weight: bold; color: yellow');
    console.log(`%cTotal Profit: Php ${ grossProfit.toLocaleString() }`, 'font-weight: bold; color: yellow');
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

    const maxLoop = 4;

    let shuffledTrueFalse = [true, false];
    let shuffledTrueFalseBuckets = [];
    let index = 0;

    while (index < (Math.floor(parseInt(((Math.random() * maxLoop) + 1).toFixed(0))))) {
        shuffledTrueFalse = shuffleArrays(shuffledTrueFalse);
        shuffledTrueFalseBuckets.push(...shuffledTrueFalse);
        shuffledTrueFalseBuckets = [...shuffleArrays(shuffledTrueFalseBuckets)]
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

function randomInt() {
    const minMinutes = 10;
    const maxMinutes = 20;
    let index = 0;
    let indexPicked = 0;

    while (index < 3) {
        indexPicked = Math.floor(Math.random() * maxMinutes);
        if (indexPicked >= minMinutes && indexPicked <= maxMinutes) {
            index++;
        }
    }

    return indexPicked;
}

function printLine() {
    console.log('%c-', 'color: black;');
}

function printCommencedShift() {
    if (isPrintedNowCommencingScheduled === true) {
        return;
    }

    printLine();

    console.log(`%c- -------------------------------------------------------- -`, 'font-weight: bold; color: #ff9400;');
    console.log(`%c- Thank you for waiting. Commencing next match. Good luck! -`, 'font-weight: bold; color: #ff9400;');
    console.log(`%c- -------------------------------------------------------- -`, 'font-weight: bold; color: #ff9400;');

    isPrintedNowCommencingScheduled = true;

    startTimelapse = window.performance.now();
}

function isWithinAllottedRacetime() {
    const now = new Date();
    const dailyTimeShifts = (new Date(now.getTime()) > new Date(now.toLocaleDateString() + ' ' + '08:59:00 AM').getTime() &&
        new Date(now.getTime()) < new Date(now.toLocaleDateString() + ' ' + '10:30:00 PM').getTime());

    if (nextRaceTimeStarts === 0) {
        return true && dailyTimeShifts;
    } else {
        return (new Date(new Date().getTime()) > nextRaceTimeStarts) && dailyTimeShifts && isWinner === true;
    }
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

    const averageProfit = (wonMatchesTotalGrossProfit / wonMatches.length).toFixed(0).toLocaleString();
    const averageProfitPercentage = (parseInt(wonMatches.map(({ odds }) => odds).reduce((a, b) => a + b, 0)) / wonMatches.length) * 100;

    return {
        totalNetProfit: wonMatchesTotalGrossProfit + lossMatchesTotalGrossProfit,
        averageProfit: averageProfit,
        averageProfitPercentage: averageProfitPercentage.toFixed(0)
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
    highestWinStreak = 0;
    lossStreak = 0;
    winStreak = 0;
    isBettingWithAccumulatedAmount = false;
    matchIndex = 1;
    isPendingPrintProfit = false;

    // will be reverse once it re-commence:
    isBetOnHigherRoi = true;
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

    return hrs + ` hour${ hrs > 1 ? 's' : '' } and ` + mins + ' minutes';
}

function overwriteOddsIfNeeded(bet, clonedDataBetOdds) {
    const { meron_odds, wala_odds } = clonedDataBetOdds.value;
    let betSideOdds = 0;
    const minimumTargetedBetOdds = 185;

    if (finalBetside === meron) {
        betSideOdds = meron_odds;
    }
    if (finalBetside === wala) {
        betSideOdds = wala_odds;
    }

    if (/*isShuffleBetSide === true && presentLevel >= 3 &&*/ betSideOdds < minimumTargetedBetOdds) {
        const addOnCapital = (minimumTargetedBetOdds - betSideOdds);
        const percentage = (addOnCapital / 100);
        const calc = bet * percentage;

        return {
            updatedBet: bet + (calc > 1 ? calc : 0),
            addOnCapital: calc > 1 ? addOnCapital : 0
        };
    }

    return {
        updatedBet: bet,
        addOnCapital: 0
    };
}

function extendBetAmount(bet) {
    const { totalNetProfit } = calculateTodaysProfit();

    if (presentLevel === 0 && isWinner === true && winStreak >= 2
        && matchLogs[matchLogs.length - 1].isExtendedBet === false && matchLogs[matchLogs.length - 2].isExtendedBet === false) {
        const proposedDoubleBet = betLevel[presentLevel] * 2;
        const proposedQuadBet = betLevel[presentLevel] * 4;

        if (totalNetProfit > proposedQuadBet) {
            return proposedQuadBet;
        } else if (totalNetProfit > proposedDoubleBet) {
            return proposedDoubleBet;
        }
    }

    return bet;
}

function reverseBetIfNeeded() {
    // Reverse bet if needed
    if (totalLossCountByFar >= 4) {
        reverseBet();
        totalLossCountByFar = 0;

        printLine();
        console.log(`%c- Betside Reversed -`, 'font-weight: bold; color: #3395ff; font-size: 12px;');
    }
}

async function chromeSendMessage(chromeTabs) {
    await new Promise(resolve => setTimeout(resolve, 500));
    chromeTabs.sendMessage(tab.id, { text: 'placeBet', betSide: finalBetside });
}

chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.status === "complete") {
        tabsOnUpdated.setTabId(tabId);
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
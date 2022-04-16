chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    const elementName = 'printRemainingTime';
    const btnInputMinus = 'btnInputMinus';
    const btnInputAdd = 'btnInputAdd';
    const isClicked = 'isClicked';

    if (msg.text === "getCrfTokenRequest") {
        sendResponse(document.getElementsByName("csrf-token")[0].content);
        return;
    }
    if (msg.text === "ancestorOrigins") {
        sendResponse(`wss://echo.${window.location.host}/socket.io/?EIO=3&transport=websocket`);
        return;
    }
    if (msg.text === "inputBet") {
        inputBet();
        return;
    }
    if (msg.text === "placeBet") {
        const $cancel = document.getElementsByClassName("swal2-cancel");
        if ($cancel.length > 0) {
            $cancel[0].click()
        }
        const betSide = msg.betSide === 'meron' ? 0 : 1;
        const $postBet = document.getElementsByClassName("post-bet");
        if ($postBet.length > 0) {
            $postBet[betSide].click();
        }
    }
    if (msg.text === "submitBet") {
        const $confirm = document.getElementsByClassName("swal2-confirm");
        if ($confirm.length > 0) {
            $confirm[0].click();
        }
    }
    if (msg.text === "isClosed") {
        const elements = document.getElementsByClassName("label-danger beting-status-label");

        if (elements.length > 0) {
            sendResponse(elements[0].innerHTML === 'CLOSED');
            return
        }
        return sendResponse(false);
    }
    if (msg.text === "setRemainingDummyPoints") {
        if (document.getElementsByClassName("currentPointsDisplay").length > 0) {
            document.getElementsByClassName("currentPointsDisplay")[0].children[0].innerHTML = `x ${parseInt(msg.remainingPoints).toLocaleString(0)} x`;
        }
    }
    if (msg.text === "remainingPoints") {
        if (document.getElementsByClassName("currentPointsDisplay").length > 0) {
            const points = document.getElementsByClassName("currentPointsDisplay")[0].children[0].innerHTML;
            if (typeof msg.withReplace !== 'undefined') {
                sendResponse(parseInt(points));
            } else {
                sendResponse(parseInt(points.replace(',', '')) - 100);
            }
        }
    }
    if (msg.text === "getClosedOdds") {
        if (document.getElementsByClassName("payoutDisplay").length > 0) {
            sendResponse(parseFloat(document.getElementsByClassName("payoutDisplay")[msg.betSide === 'meron' ? 0 : 1].innerText.toString().replace('PAYOUT = ', '')))
        }
    }
    if (msg.text === "submitDummyBet") {
        if (msg.betAmountPlaced === 0) {
            document.getElementsByClassName("my-bets")[0].innerText = '0';
            document.getElementsByClassName("my-bets")[1].innerText = '0';
            return;
        }

        const submittedBetText = `<span>${parseInt(msg.betAmountPlaced).toLocaleString(0)}</span>`;

        document.getElementsByClassName("my-bets")[msg.betSide === 'meron' ? 0 : 1].innerHTML =
            typeof msg.calculatedWinning === 'undefined'
                ? submittedBetText
                : `${submittedBetText} = <span style=\"color:white;background-color: dodgerblue\">P ${parseInt(msg.calculatedWinning).toLocaleString(0)}<span/>`;
    }
    if (msg.text === "reload") {
        window.location.reload();
    }
    if (msg.text === "submittedBetValue") {
        const betSide = msg.betSide === 'meron' ? 0 : 1;
        if (document.getElementsByClassName("my-bets").length > 0) {
            sendResponse(parseInt(document.getElementsByClassName("my-bets")[betSide].innerText.replace(',', '')));
        }
    }
    if (msg.text === 'logout') {
        window.location.href = `${window.location.origin}/logout`;
    }
    if (msg.text === 'hasAttributes') {
        sendResponse({
            isMinus: document.getElementById(btnInputMinus)?.hasAttribute(isClicked) ?? false,
            isAdd: document.getElementById(btnInputAdd)?.hasAttribute(isClicked) ?? false
        });
    }
    if (msg.text === elementName) {
        removePrintRemainingTime();

        function addFunction(elementId) {
            return `document.getElementById('${elementId}').setAttribute('${isClicked}','true'); document.getElementById('${elementId}').setAttribute('style','border-color:#1e81f1;border-width:3px;');`
        }

        document.getElementsByClassName('float-left img-fluid')[0].insertAdjacentHTML("afterend",
            `<div id="${elementName}" style="position: absolute;margin-left: 30%;margin-top: 3px;width: 300px;"> <table> <tbody><tr> <td> <input id="${btnInputMinus}" type="button" onclick="${addFunction(btnInputMinus)}" value="-10"> </td> <td> <h5 id="printRemainingTime" style="text-align: left;padding-top: 12px;padding-left: 7px;padding-right: 7px;color: #ff00eb;text-shadow: 0px 1px whitesmoke;">${msg.timerIndex.toString().padStart(2, '0')} of ${msg.maxWaitTimes} seconds</h5> </td> <td> <input type="button" id="${btnInputAdd}" onclick="${addFunction(btnInputAdd)}" value="+10"> </td> </tr> </tbody></table> </div>`);
    }
    if (msg.text === "printRemainingSkipMatches") {
        const id = 'skipMatch';
        const $img = document.getElementsByClassName('float-left img-fluid');
        const $skipMatch = document.getElementById(id);

        if ($skipMatch != null) {
            $skipMatch.remove();
        }
        if ($img.length > 0) {
            $img[0].insertAdjacentHTML("afterend",
                `<div id='${id}' style="position: absolute;margin-left: 30%;margin-top: 3px;width: 300px;"> <table> <tbody><tr> <td> <h5 style="text-align: left;padding-top: 12px;padding-left: 7px;padding-right: 7px;color: #fdda11;text-shadow: 0px 1px #0b4591;">Skipping Matches: ${msg.indexSkip} of ${msg.maxSkip}</h5> </td>  </tr> </tbody></table> </div>`);
        }
    }
    if (msg.text === "deletePrintRemainingSkipMatches") {
        const elem = document.getElementById('skipMatch');
        if (elem !== null) {
            elem.parentNode.removeChild(elem);
        }
    }
    if (msg.text === "deletePrintRemainingTime") {
        removePrintRemainingTime();
    }
    if (msg.text === "isLoginPage") {
        sendResponse(document.getElementById('password') !== null);
    }
    if (msg.text === "printBetLevelTable") {
        const printBetLevelTableID = 'betLevelTable';
        const elem = document.getElementById(printBetLevelTableID);
        if (elem !== null) {
            elem.parentNode.removeChild(elem);
        }

        const $card = document.getElementsByClassName("card mb-1");
        if ($card.length > 0 && msg.betLevel.length > 0) {
            let betTd = '';

            msg.betLevel.forEach(function (bet, index) {
                betTd += `<td style="border: 3px solid yellow;width:${100 / msg.betLevel.length}%;background-color: ${index <= msg.presentLevel - 1 ? '#f34141' : 'none'}">` +
                    `       <h5 style="text-align: center;padding-top: 16px;${msg.presentLevel === index ? 'color:#1e81f1;text-decoration:underline' : `color:${index <= msg.presentLevel - 1 ? '#ff8686' : 'white'}`}">` +
                    `           ${bet}` +
                    '       </h5>' +
                    '</td>'
            });

            $card[0].insertAdjacentHTML("afterend",
                `<div id="${printBetLevelTableID}">` +
                '   <table style="border: 3px solid yellow;width:100%">' +
                '       <tbody>' +
                '           <tr>' +
                '               ' + betTd +
                '           </tr>' +
                '       </tbody>' +
                '   </table>' +
                '</div>');
        }
    }
    if (msg.text === "printGameOver") {
        if (document.getElementById('password') !== null) {
            const $img = document.getElementsByClassName('header-mobile__logo-img');
            if ($img.length > 0) {
                $img[0].insertAdjacentHTML("afterend", "<label style='font-size:50px;color:red;font-weight:bold;padding-top:30px'>GAME OVER!</label>");
            }
        }
    }
    if (msg.text === "printQuoteReached") {
        if (document.getElementById('password') !== null) {
            const $img = document.getElementsByClassName('header-mobile__logo-img');
            if ($img.length > 0) {
                $img[0].insertAdjacentHTML("afterend", "<label style='font-size:100px;color:#04ff00;font-weight:bold;padding-top:60px'>&#x26CA;&#x26CA;&#x26CA;&#x26CA;&#x26CA;</label>");
            }
        }
    }
    if (msg.text === "getLocationOrigin") {
        sendResponse(`${ window.location.origin }`);
    }
    function inputBet() {
        if (document.getElementsByClassName("betAmount").length > 0) {
            document.getElementsByClassName("betAmount")[0].focus();
            document.execCommand('delete', false);
            document.execCommand('delete', false);
            document.execCommand('delete', false);
            document.execCommand('delete', false);
            document.execCommand('delete', false);
            document.execCommand('delete', false);
            document.execCommand('insertText', false, msg.betAmountPlaced);
        }
    }

    function removePrintRemainingTime() {
        const elem = document.getElementById(elementName);
        if (elem !== null) {
            elem.parentNode.removeChild(elem);
        }
    }
});

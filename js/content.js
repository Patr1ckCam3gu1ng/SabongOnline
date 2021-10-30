chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    const elementName = 'printRemainingTime';
    if (msg.text === "getCrfTokenRequest") {
        sendResponse(document.getElementsByName("csrf-token")[0].content);
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
    if (msg.text === "remainingPoints") {
        sendResponse(parseInt(document.getElementsByClassName("currentPointsDisplay")[0].children[0].innerHTML.replace(',', '')) - 100);
    }
    if (msg.text === "submittedBetValue") {
        const betSide = msg.betSide === 'meron' ? 0 : 1;
        try {
            sendResponse(parseInt(document.getElementsByClassName("my-bets")[betSide].innerText.replace(',', '')));
        } catch (e) {
        }
    }
    if (msg.text === elementName) {
        removePrintRemainingTime();
        document.getElementsByClassName('float-left img-fluid')[0].insertAdjacentHTML("afterend",
            `<h5 id="${elementName}" style="text-align: left; position: absolute; margin-left: 40%; margin-top: 15px; color: #ff00eb; text-shadow: 0px 1px #f1f1f1; ">${msg.timerIndex} of ${msg.maxWaitTimes} seconds</h5>`);
    }
    if (msg.text === "deletePrintRemainingTime") {
        removePrintRemainingTime();
    }
    function inputBet() {
        document.getElementsByClassName("betAmount")[0].focus();
        document.execCommand('delete', false);
        document.execCommand('delete', false);
        document.execCommand('delete', false);
        document.execCommand('delete', false);
        document.execCommand('delete', false);
        document.execCommand('delete', false);
        document.execCommand('insertText', false, msg.betAmountPlaced);
    }
    function removePrintRemainingTime() {
        const elem = document.getElementById(elementName);
        if (elem !== null) {
            elem.parentNode.removeChild(elem);
        }
    }
});
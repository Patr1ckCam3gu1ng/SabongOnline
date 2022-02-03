chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    const elementName = 'printRemainingTime';
    const btnInputMinus = 'btnInputMinus';
    const btnInputAdd = 'btnInputAdd';
    const isClicked = 'isClicked';

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
    if (msg.text === "setRemainingDummyPoints") {
        document.getElementsByClassName("currentPointsDisplay")[0].children[0].innerHTML = `x ${parseInt(msg.remainingPoints).toLocaleString(0)} x`;
    }
    if (msg.text === "remainingPoints") {
        sendResponse(parseInt(document.getElementsByClassName("currentPointsDisplay")[0].children[0].innerHTML.replace(',', '')) - 100);
    }
    if (msg.text === "submitDummyBet") {
        if (msg.betAmountPlaced === 0) {
            document.getElementsByClassName("my-bets")[0].innerText = '0';
            document.getElementsByClassName("my-bets")[1].innerText = '0';
            return;
        }

        document.getElementsByClassName("my-bets")[msg.betSide === 'meron' ? 0 : 1].innerText = `x ${parseInt(msg.betAmountPlaced).toLocaleString(0)} x`
    }
    if (msg.text === "reload") {
        window.location.reload();
    }
    if (msg.text === "submittedBetValue") {
        const betSide = msg.betSide === 'meron' ? 0 : 1;
        try {
            sendResponse(parseInt(document.getElementsByClassName("my-bets")[betSide].innerText.replace(',', '')));
        } catch (e) {
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

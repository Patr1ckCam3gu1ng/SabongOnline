const btnStartNow = document.getElementById("btnStarNow");

btnStartNow.addEventListener("click", async () => {
    const port = chrome.extension.connect({
        name: "getCrfToken"
    });
    port.postMessage('');
});
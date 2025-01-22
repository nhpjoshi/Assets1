chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'changeColor') {
      document.body.style.backgroundColor = 'lightblue';
    }
  });
  
const query = require("./queries");
const utils = require("./utils");

// check and delete expired links every 30 seconds
const expiredLinksInterval = setInterval(function () {
  query.link.batchRemove({ expire_in: ["<", utils.dateToUTC(new Date())] }).catch(error => {
    console.error("Delete expired links error:", error);
  });
}, 30_000);

if (typeof expiredLinksInterval.unref === "function") {
  expiredLinksInterval.unref();
}

function stop() {
  clearInterval(expiredLinksInterval);
}

module.exports = {
  stop,
};

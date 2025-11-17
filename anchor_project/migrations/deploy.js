const anchor = require("@coral-xyz/anchor");
module.exports = async function (provider) {
  anchor.setProvider(provider);
  // opcional: seeds/setup pós-deploy
};

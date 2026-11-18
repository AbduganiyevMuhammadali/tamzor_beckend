// index.js
const { Sequelize } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');
const path = require('path');
const sequelize = require('../db/db-sequelize');

const umzug = new Umzug({
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
  migrations: {
    glob: path.join(__dirname, '../../migrations/*.js'),
    resolve: ({ name, path: migPath, context }) => {
      const migration = require(migPath);
      return {
        name,
        up: async () => migration.up(context, Sequelize),
        down: async () => migration.down(context, Sequelize),
      };
    },
  },
});

module.exports = async function(){
    try{
        await umzug.up();
    }catch(e){
        console.log('Xatolik', e);
    }
}
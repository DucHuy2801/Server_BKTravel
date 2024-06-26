'use strict'

const { DataTypes, Model } = require("sequelize")
const sequelize = require("../database/connect.mysql")
const Attraction = require("./attraction.model")
const Hotel = require("./hotel.model")

class Destination extends Model {}

Destination.init({
    destination_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    country: {
        type: DataTypes.STRING,
        allowNull: true
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, { sequelize, modelName: 'destination' })

Destination.hasMany(Attraction, { foreignKey: 'destination_id' })
Destination.hasMany(Hotel, { foreignKey: "destination_id" })
module.exports = Destination

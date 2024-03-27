'use strict'

const { DataTypes, Model } = require('sequelize');
const sequelize = require('../database/index');
const Order = require('./order.model');
const Tour = require('./tour.model');

class OrderTour extends Model {}
OrderTour.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    tour_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    order_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    }
}, { sequelize, modelName: "order_tour" })

Order.belongsToMany(Tour, { through: OrderTour, foreignKey: "order_id" })
Tour.belongsToMany(Order, { through: OrderTour, foreignKey: "tour_id" })

module.exports = OrderTour



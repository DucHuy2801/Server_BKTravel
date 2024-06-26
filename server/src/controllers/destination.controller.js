'use strict'

const Destination = require("../models/destination.model")
const Attraction = require("../models/attraction.model")
const fs = require("fs")
const path = require('path');
const { checkExistDestination } = require("../services/destination.service");
const Hotel = require("../models/hotel.model");
const jsonFilePath = path.join(__dirname, '../data', 'destination_data.json');
const cityFilePath = path.join(__dirname, '../data', 'city_data.json');
const cityVNFilePath = path.join(__dirname, '../data', 'city_vi_data.json');

class DestinationController {

    loadDestinationsFromJsons = async(req, res, next) => {
        const data = await fs.readFileSync(jsonFilePath, 'utf-8')
        const jsonData = JSON.parse(data)

        const destinations = await Promise.all(jsonData.destinations.map(async destinationData => {
            const destination = await checkExistDestination(destinationData.name)

            if (!destination) {
                const dest = await Destination.create({ name: destinationData.name})
                
                // create attraction of destination
                await Promise.all(destinationData.attractions.map(async attractionName => {
                    const [attraction, createdAttraction] = await Attraction.findOrCreate({
                        where: { name: attractionName.name},
                        defaults: { name: attractionName.name, destination_id: destination.destination_id }
                    })
                }))

                // create hotels of destination
                await Promise.all(destinationData.hotels.map(async hotelInfo => {
                    const [hotel, createdHotel] = await Hotel.findOrCreate({
                        where: { 
                            name: hotelInfo.name 
                        },
                        defaults: { 
                            name: hotelInfo.name, 
                            price: hotelInfo.price, 
                            rating: hotelInfo.rating,
                            description: hotelInfo.description,
                            destination_id: destination.destination_id
                        }
                    })  
                })) 
            } else {

                // create attraction of destination
                await Promise.all(destinationData.attractions.map(async attractionName => {
                    const [attraction, createdAttraction] = await Attraction.findOrCreate({
                        where: { name: attractionName.name},
                        defaults: { name: attractionName.name, destination_id: destination.destination_id }
                    })
                }))

                // create hotels of destination
                await Promise.all(destinationData.hotels.map(async hotelInfo => {
                    const [hotel, createdHotel] = await Hotel.findOrCreate({
                        where: { 
                            name: hotelInfo.name 
                        },
                        defaults: { 
                            name: hotelInfo.name, 
                            price: hotelInfo.price, 
                            rating: hotelInfo.rating,
                            description: hotelInfo.description,
                            destination_id: destination.destination_id
                        }
                    })  
                })) 
            }
        }))
        return res.status(201).json({
            message: "Create attraction and hotel for destination successfully!"
        })
    }

    getAllDestinations = async(req, res, next) => {
        try {
            const all_destinations = await Destination.findAll({
                attributes: {
                    exclude: ['updatedAt', 'createdAt']
                }
            })
            return res.status(200).json({
                message: "Get all destinations successfully!",
                data: all_destinations
            })
        } catch(error) {
            return res.status(500).json({ message: error.message })
        }
    }    

    getAllCities = async (req, res, next) => {
        try {
            const data = await fs.readFileSync(cityFilePath, 'utf-8')
            const cities = JSON.parse(data)

            const dataVN = await fs.readFileSync(cityVNFilePath, 'utf-8')
            const citiesVN = JSON.parse(dataVN)

            return res.status(200).json({
                message: "Get cities successfully!",
                cities: cities,
                citiesVN: citiesVN
            })
        } catch (error) {
            return res.status(500).json({ message: error.message })
        }
    }
}

module.exports = new DestinationController()
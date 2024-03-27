'use strict'

const { StatusTour } = require("../common/status")
const Attraction = require("../models/attraction.model")
const OtherAttraction = require("../models/other_attraction.model")
const Schedule = require("../models/schedule.model")
const { findTourById } = require("../services/tour.service")

class ScheduleController {
    createSchedule = async(req, res, next) => {
        try {
            const tour_id = req.body.tour_id
            const tour = await findTourById(tour_id)
            if (!tour) return res.status(404).json({ message: "Not found tour for creating schedule!" })

            const exist_schedule = await Schedule.findOne({ where: { tour_id: tour_id }})
            if (exist_schedule) return res.status(400).json({ message: "Tour has already been scheduled! "})

            const schedule_detail = req.body.schedule_detail

            for (const schedule of schedule_detail) {
                for (const detail of schedule.detail) {
                    const name = detail.name;

                    const attraction = await Attraction.findOne({ where: { name: name }})
                    if (!attraction) {
                        let exist_attraction = await OtherAttraction.findOne({ where: { name: name }})
                        if (!exist_attraction) {
                            exist_attraction = await OtherAttraction.create({
                                name: detail.name,
                                note: detail.note || null,
                                description: detail.description
                            })
                        }
                        else {
                            exist_attraction.note = detail.note || null;
                            exist_attraction.description = detail.description;
                            await exist_attraction.save()
                        }
                    }
                    else {
                        attraction.note = detail.note || null;
                        attraction.description = detail.description;
                        await attraction.save()
                    }
                }
            }
            const new_schedule = await Schedule.create({
                schedule_detail: JSON.parse(JSON.stringify(schedule_detail)),
                tour_id: tour_id
            })

            tour.status = StatusTour.ONLINE
            await tour.save()
            
            return res.status(201).json({ 
                data: new_schedule,
                message: "Create schedule for tour successfully! "
            })
            
        } catch(error) {
            return res.status(500).json({ message: error.message })
        }
    }

    deleteSchedule = async(req, res, next) => {
        try {
            const tour_id = req.params.tour_id
            const schedule = await Schedule.findOne({ where: { tour_id: tour_id} })
            await schedule.destroy()
            return res.status(200).json({ message: "Delete schedule successfully!" })
        } catch(error) {
            return res.status(500).json({ message: error.message })
        }
    }
}

module.exports = new ScheduleController()
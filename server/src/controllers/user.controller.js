'use strict'

const cloudinary = require("../utils/cloudinary")

const User = require("../models/user.model")
const sendMail = require("../utils/sendMail")
const bcrypt = require("bcrypt")
const moment = require("moment")
const { isExpired } = require("../utils/checkExpire")
const Wishlist = require("../models/wishlist.model")
const Tour = require("../models/tour.model")
const Order = require("../models/order.model")
const WishlistTour = require("../models/wishlist_tour.model")
const OrderTour = require("../models/order_tour.model")
const { findUserById } = require("../services/user.service")
const { findTourById } = require("../services/tour.service")

class UserController {

    getInfoUser = async (req, res) => {
        const user_id = req.params.user_id;
        const user = await User.findOne({
            where: {user_id},
            attributes: {
                exclude: ['access_token', 'refresh_token', 'createdAt', 'updatedAt', 'code', 'expired_time_code']
            }
        })
        if (!user) return res.status(404).json({ Message: "User doesn't exist!"})
        return res.status(200).json({
            user_info: user
        })
    }

    updateInfoUser = async (req, res) => {
        const user_id = req.params.user_id
        const update_info = req.body
        
        const result = await User.update(update_info, {
            where: { user_id }
        })

        const updated_user = await User.findOne({ 
            where: { user_id },
            attributes: {
                exclude: ['access_token', 'refresh_token', 'createdAt', 'updatedAt']
            }
        })
        return res.status(200).json({ 
            status: "Update user's info successfully!",
            data: updated_user
        })
    }

    uploadAvatar = async (req, res) => {
        try {
            const avatar = req.file.path
            const user_id = req.params.user_id
            const user = await User.findOne({ where: { user_id }})
            if (!user) {
                return res.status(404).json({Message: "Not found user!"})
            }
            const result = await cloudinary.uploader.upload(avatar)

            const data = {
                avatar: result.secure_url
            }
            const updated_user = await User.update(data, {
                where: { user_id }
            })
            if (updated_user != 1) {
                return res.status(403).json({ 
                    message: "Upload fail!"
                })
            }
            return res.status(200).json({ 
                url_image: result.secure_url,
                message: "Upload profile picture successfully!" 
            })
            

        } catch (error) {
            return res.status(404).json({
                message: "false"
            })
        }
    }

    changePassword = async (req, res, next) => {
        const email = req.body.email;
        const old_password = req.body.old_password;
        const new_password = req.body.new_password;
        const confirm_password = req.body.confirm_password;

        const user = await User.findOne({ where: { email }})
        if (!user) 
            return res.status(404).json({ Message: "Not found user!" })

        const match = await bcrypt.compareSync(old_password, user.password);

        if (!match)
            return res.status(400).json({ Message: "Password is wrong!" }) 

        if (confirm_password !== new_password) 
            return res.status(500).json({ Message: "Password doesn't match!"})
        const password = await bcrypt.hash(new_password, 10)
        const update_password = await User.update(
            { password: password },
            { where: { email }}
        )
        if (!update_password) return res.status(500).json({Message: "Change password fail!"})
        return res.status(200).json({ message: "Change password successfully!" })
    }

    forgotPassword = async (req, res, next) => {
        try {
            const { email } = req.body;
            const user = await User.findOne({ where: { email }})
            if (!user) {
                return res.status(404).json({ status: 'Fail', message: "Gmail is not used by account!" })
            }
            const code = Math.floor(100000 + Math.random()*900000)
            const expirationTime = moment().add(2, 'minutes');
            user.code = code;
            user.expired_time_code = expirationTime;
            await user.save()

            sendMail(email, code)
            return res.status(200).json({
                status: 'Success',
                message: 'Send mail, please check to your gmail!',
            })
        } catch (error) {
             return res.status(500).json({ status: 'Faile', message: error.message })
        } 
    }

    resetPassword = async (req, res, next) => {
        const { new_password, confirm_password, code } = req.body

        const user = await User.findOne({ where: { code }})

        if (!user || (user.code !== code)) 
            return res.status(400).json({ Message: "Code is wrong!"})

        const checkValid = await isExpired(user.expired_time_code);
        if (!checkValid) {
            user.expired_time_code = null;
            user.code = null;
            return res.status(400).json({ Message: "Code is expired!"})
        }
        
        if (new_password !== confirm_password) 
            return res.status(400).json({ Message: "Password doesn't match"})

        try {
            const hash_password = await bcrypt.hash(new_password, 10)
            const update_password = await User.update({ 
                password: hash_password, code: null, expired_time_code: null }, {
                    where: { code }
                }
            )
            if (!update_password) {
                return res.status(400).json({ Message: "Change password fail!"})
            }
            return res.status(200).json({ Message: "Change password successfully!"})
        } catch (error) {
            console.log(error)
            return res.status(404).json({ Message: error })
        }
        
    }

    addTourToWishlist = async (req, res, next) => {
        const { tour_id, user_id } = req.params
        try {
            const existWishlist = await Wishlist.findOne({
                where: {
                   user_id: user_id
                }
            })
            
            let wishlist
            if (!existWishlist) {
                wishlist = await Wishlist.create({
                    user_id: user_id
                })
            }
            console.log(`1`)
            console.log(`exist`, existWishlist ? existWishlist.wishlist_id : wishlist.wishlist_id)
            
            const wishlist_tour = await WishlistTour.findOrCreate({
                where: {
                    wishlist_id: existWishlist ? existWishlist.wishlist_id : wishlist.wishlist_id,
                    tour_id: tour_id
                },
                defaults: {
                    wishlist_id: existWishlist ? existWishlist.wishlist_id : wishlist.wishlist_id,
                    tour_id: tour_id
                }
            })

            return res.status(201).json({
                message: "Add tour to wishlist successfully!"
            })
        } catch (error) {
            return res.status(500).json({
                message: error.message
            })
        }
    }

    getWishlistByCustomer = async (req, res, next) => {
        const user_id = req.params.user_id;
    
        try {
            const user = await findUserById(user_id)
            if (!user) {
                return res.status(404).json({ message: "Not found user" });
            }
    
            const wishlist = await WishlistTour.findAll({
                where: {
                    wishlist_id: user_id
                }
            })

            const tour_ids = wishlist.map((wishlist_tour) => wishlist_tour.dataValues.tour_id)
            const tours = await Tour.findAll({
                where: {
                    tour_id: tour_ids
                }
            })
            return res.status(200).json({
                message: "Get wishlist successfully",
                data: tours,
            });
        } catch (error) {
            return res.status(500).json({ message: error.message });
        }
    };    

    removeTourFromWishlist = async (req, res, next) => {
        const { tour_id, user_id } = req.params;
        try {
            const user = await findUserById(user_id)
            if (!user) return res.status(404).json({ message: "Not found user!" })

            const tour = await findTourById(tour_id)
            if (!tour) return res.status(404).json({ message: "Not found tour!" })

            const wishlist = await WishlistTour.findOne({
                where: {
                    wishlist_id: user_id,
                    tour_id: tour_id
                }
            })
            if (!wishlist) return res.status(404).json({ message: "Tour not found in the wishlist!" })
            await wishlist.destroy()
            return res.status(200).json({
                message: "Remove tour from wishlist successfully!"
            })
        } catch (error) {
            return res.status(500).json({ message: error.message })
        }
    }

    addTourToOrder = async (req, res, next) => {
        const { tour_id, user_id } = req.params
        try {
            // const existOrder = await Order.findOne({
            //     where: {
            //        user_id: user_id
            //     }, include: [{
            //         model: Tour,
            //         where: {
            //             tour_id: tour_id
            //         }
            //     }]
            // })

            // if (existOrder) {
            //     return res.status(400).json({
            //         message: "Tour already exists in the wishlist!"
            //     })
            // }
            const new_order = await OrderTour.create({
                order_id: user_id,
                tour_id: tour_id
            })

            return res.status(201).json({
                message: "Add tour to order successfully!",
                wishlist: new_order
            })
        } catch (error) {
            return res.status(500).json({
                message: error.message
            })
        }
    }

    getAllToursFromOrder = async (req, res, next) => {
        const user_id = req.params.user_id
        const user = User.findByPk(user_id)
        if (!user) 
            return res.status(404).json({ message: "Not found user!"})

        const userOrders = await Order.findAll({
            where: {
                user_id: user_id
            }, include: [{
                model: Tour,
                // attributes: ['tour_id', 'name', 'departure_date', 'price'],
            }]
        })

        if (!userOrders) return res.status(404).json({ message: "Can't get all tours from orders!"})
        return res.status(200).json({
            message: "Get all tours from orders successfully!",
            data: userOrders
        })
    }

    cancelOrderTour = async (req, res, next) => {
        const { user_id, tour_id, order_id } = req.params

        try {
            const order = await Order.findOne({
                where: {
                    user_id: user_id,
                    order_id: order_id
                },
                include: [{
                    model: Tour,
                    where: { tour_id: tour_id }
                }]
            })

            if (!order) 
                return res.status(404).json({ message: "Not found order" })

            await order.update({ tour_id: null }, {
                where: { tour_id: tour_id }
            })

            res.status(200).json({ message: 'Tour removed from order successfully' });
            
        } catch (error) {
            return res.status(500).json({
                message: error.message
            })
        }
    }
}

module.exports = new UserController()
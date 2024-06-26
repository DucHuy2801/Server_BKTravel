'use strict'

const moment = require('moment');
const { sortObject } = require("../utils/payment")
let querystring = require('qs');
const crypto = require('crypto');
const { findTourById } = require('../services/tour.service');
const OrderItem = require('../models/order_item.model');
const OrderTour = require('../models/order_tour.model')
const User = require('../models/user.model')
const Order = require('../models/order.model');
const { StatusOrder } = require('../common/index');
const { findVoucherById } = require('../services/voucher.service');
const axios = require("axios")
const redis = require("redis")
let redisClient;
(async () => {
    redisClient = redis.createClient();
    redisClient.on("error", (error) => console.error(`Error : ${error}`));
    redisClient.on("connect", () => console.log("Redis connected"));
    await redisClient.connect();
})();
const tmnCode = process.env.vnp_TmnCode;
const secretKey = process.env.vnp_HashSecret;
let url = process.env.vnp_Url;
const returnUrl = process.env.vnp_ReturnUrl; 

class PaymentController {
    /**
     * 
     * @param {*} req 
     * @param {*} res 
     * @param {*} next 
     * @body {
     *      order_items: [...]
     * }
     */
    createPaymentUrl = async (req, res, next) => {
        try {
            const { user_id, voucher_id} = req.body;
            const user = await User.findOne({ where: { user_id: user_id }})
            if (!user) return res.status(404).json({ message: "Not found user for payment!" })

            let date = new Date();
            let createDate = moment(date).format('YYYYMMDDHHmmss');
            let orderId = moment(date).format('DDHHmmss');

            const new_order = await Order.create({
                payment_time: new Date(),
                status: StatusOrder.PENDING,
                total: 0,
                user_id: user_id,
                payment_id: orderId
            })

            let total_price = 0;
            for (const item of req.body.order_items) {
                const order_item = await OrderItem.findOne({ where: { id: item }});
                if (!order_item) return res.status(404).json({ message: "Not found order item!" })
                order_item.order_id = new_order.order_id;
                await order_item.save()

                let tour = await findTourById(order_item.tour_id)
                if (tour.current_customers >= tour.max_customer)
                    return res.status(400).json({ message: "Tour is full!"})

                const adultTotal = order_item.adult_quantity * parseFloat(order_item.price);
                const childTotal = 0.75 * order_item.child_quantity * parseFloat(order_item.price);
                let total_item = adultTotal + childTotal;

                if (order_item.adult_quantity + order_item.child_quantity + tour.current_customers > tour.max_customer)
                    return res.status(400).json({ message: "Slot is full!"});
                total_price += parseFloat(total_item);
                
                tour.current_customers += (order_item.adult_quantity + order_item.child_quantity);
                await tour.save()

                redisClient.del("online_tours")
            }
            new_order.total = total_price;
            await new_order.save()

            process.env.TZ = 'Asia/Ho_Chi_Minh';
        
            let ipAddr = req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;
        
            let amount = total_price;
            let bankCode = 'NCB';

            // apply voucher to order
            const voucher = await findVoucherById(voucher_id)
            if (!voucher) return res.status(404).json({ message: "Not found voucher for using!" })
            amount = voucher.type == 'percentage' ? parseFloat((1 - voucher.value_discount) * amount)
                    : parseFloat(amount) - voucher.value_discount
            
            let vnpUrl = url;
            let currCode = 'VND';
            let vnp_Params = {};
            vnp_Params['vnp_Version'] = '2.1.0';
            vnp_Params['vnp_Command'] = 'pay';
            vnp_Params['vnp_TmnCode'] = tmnCode;
            vnp_Params['vnp_Locale'] = 'vn';
            vnp_Params['vnp_CurrCode'] = currCode;
            vnp_Params['vnp_TxnRef'] = orderId;
            vnp_Params['vnp_OrderInfo'] = `Thanh toan don hang ve du lich`;
            vnp_Params['vnp_OrderType'] = 'other';
            vnp_Params['vnp_Amount'] = amount * 100;
            vnp_Params['vnp_ReturnUrl'] = returnUrl;
            vnp_Params['vnp_IpAddr'] = ipAddr;
            vnp_Params['vnp_CreateDate'] = createDate;
            vnp_Params['vnp_BankCode'] = bankCode;
        
            vnp_Params = sortObject(vnp_Params);
        
            let signData = querystring.stringify(vnp_Params, { encode: false });
            let hmac = crypto.createHmac("sha512", secretKey);
            vnp_Params['vnp_SecureHash'] = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
            vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });

            return res.status(200).json({
                link_payment: vnpUrl,
                order: new_order
            }) 
        } catch (error) {
            return res.status(500).json({ message: error.message })
        }
    }

    getResultPayment = async (req, res, next) => {
        try {
            const vnp_Params = req.query;
            const secureHash = vnp_Params['vnp_SecureHash'];
    
            delete vnp_Params['vnp_SecureHash'];
            delete vnp_Params['vnp_SecureHashType'];
    
            const sortedParams = sortObject(vnp_Params);
    
            const signData = querystring.stringify(sortedParams, { encode: false });  
            
            const hmac = crypto.createHmac("sha512", process.env.vnp_HashSecret);
            const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
    
            if(secureHash === signed){
                const orderId = vnp_Params['vnp_TxnRef'];
                const rspCode = vnp_Params['vnp_ResponseCode'];
                
                if (rspCode === '00') {
                    // convert status of order ---> COMPLETE
                    const order = await Order.findOne({ where: { payment_id: orderId }})
                    order.status = StatusOrder.COMPLETE;
                    await order.save()

                    // update current_customers & booked_number tour
                    const listOrderItems = await OrderItem.findAll({ where: { order_id: order.order_id } });
                    
                    for (const orderItem of listOrderItems) {
                        console.log("orderItem.is_updated_slot", orderItem.is_updated_slot)
                        if (orderItem.is_updated_slot == false) {
                            const tour = await findTourById(orderItem.tour_id)
                            tour.current_customers += orderItem.quantity
                            tour.booked_number += orderItem.quantity
                            orderItem.is_updated_slot = true
                            await tour.save()
                            await orderItem.save()
                            redisClient.del("online_tours")
                        }
                        else continue

                        await orderItem.update({ cart_id: null });
                    }
                    
                    return res.status(200).json({ RspCode: '00', Message: 'You pay for order successfully!' });
                } else {
                    // convert status of order ---> FAILED
                    const order = await Order.findOne({ where: { payment_id: orderId }})
                    order.status = StatusOrder.FAILED;
                    await order.save()

                    return res.status(200).json({ RspCode: rspCode, Message: 'Transaction failed' });
                }
            } else {
                return res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
            }
        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ message: "Internal server error" });
        }
    }

    returnPayment = async (req, res, next) => {
        let vnp_Params = req.query;
        let secureHash = vnp_Params["vnp_SecureHash"];
    
        delete vnp_Params["vnp_SecureHash"];
        delete vnp_Params["vnp_SecureHashType"];
    
        vnp_Params = sortObject(vnp_Params);

        let signData = querystring.stringify(vnp_Params, { encode: false });
        let crypto = require("crypto");
        let hmac = crypto.createHmac("sha512", secretKey);
        let signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");
    
        if (secureHash === signed) {
            res.send({ code: vnp_Params["vnp_ResponseCode"] });
        } else {
            res.send({ code: "97" });
        }
    }

    refundPayment = async (req, res, next) => {
        try {
            const { order_id, payment_id } = req.body
            const order = await Order.findOne({
                where: {
                    order_id: order_id,
                    payment_id: payment_id
                }
            })
            
            if (!order) {
                return res.status(404).json({ message: "Not found order to refund!" })
            }

            let date = new Date();
            let createDate = moment(date).format('YYYYMMDDHHmmss');
            process.env.TZ = 'Asia/Ho_Chi_Minh';
        
            let ipAddr = req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;
        
            let amount = order.total_to_pay;
            let bankCode = 'NCB';

            let vnpUrl = url;
            let currCode = 'VND';
            let vnp_Params = {};
            vnp_Params['vnp_Version'] = '2.1.0';
            vnp_Params['vnp_Command'] = 'pay';
            vnp_Params['vnp_TmnCode'] = tmnCode;
            vnp_Params['vnp_Locale'] = 'vn';
            vnp_Params['vnp_CurrCode'] = currCode;
            vnp_Params['vnp_TxnRef'] = payment_id;
            vnp_Params['vnp_OrderInfo'] = `Hoàn tiên cho khách hàng ${order.name_customer}`;
            vnp_Params['vnp_OrderType'] = 'other';
            vnp_Params['vnp_Amount'] = amount * 100;
            vnp_Params['vnp_ReturnUrl'] = returnUrl;
            vnp_Params['vnp_IpAddr'] = ipAddr;
            vnp_Params['vnp_CreateDate'] = createDate;
            vnp_Params['vnp_BankCode'] = bankCode;
        
            vnp_Params = sortObject(vnp_Params);
        
            let signData = querystring.stringify(vnp_Params, { encode: false });
            let hmac = crypto.createHmac("sha512", secretKey);
            vnp_Params['vnp_SecureHash'] = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
            vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });

            return res.status(200).json({
                link_payment: vnpUrl,
                order: order
            }) 
        } catch (error) {
            return res.status(500).json({ message: error.message })
        }
    }

    refundPaymentForUser = async (req, res, next) => {
        try {
            const { order_id, payment_id } = req.body
            const order = await Order.findOne({
                where: {
                    order_id: order_id,
                    payment_id: payment_id
                }
            })
            
            if (!order) {
                return res.status(404).json({ message: "Not found order to refund!" })
            }

            let date = new Date();
            let createDate = moment(date).format('YYYYMMDDHHmmss');
            process.env.TZ = 'Asia/Ho_Chi_Minh';
        
            let ipAddr = req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;
        
            let amount = parseFloat(order.total_to_pay) * 0.8;
            let bankCode = 'NCB';

            let vnpUrl = url;
            let currCode = 'VND';
            let vnp_Params = {};
            vnp_Params['vnp_Version'] = '2.1.0';
            vnp_Params['vnp_Command'] = 'pay';
            vnp_Params['vnp_TmnCode'] = tmnCode;
            vnp_Params['vnp_Locale'] = 'vn';
            vnp_Params['vnp_CurrCode'] = currCode;
            vnp_Params['vnp_TxnRef'] = payment_id;
            vnp_Params['vnp_OrderInfo'] = `Hoàn tiên cho khách hàng ${order.name_customer}`;
            vnp_Params['vnp_OrderType'] = 'other';
            vnp_Params['vnp_Amount'] = amount * 100;
            vnp_Params['vnp_ReturnUrl'] = returnUrl;
            vnp_Params['vnp_IpAddr'] = ipAddr;
            vnp_Params['vnp_CreateDate'] = createDate;
            vnp_Params['vnp_BankCode'] = bankCode;
        
            vnp_Params = sortObject(vnp_Params);
        
            let signData = querystring.stringify(vnp_Params, { encode: false });
            let hmac = crypto.createHmac("sha512", secretKey);
            vnp_Params['vnp_SecureHash'] = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
            vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });

            return res.status(200).json({
                link_payment: vnpUrl,
                order: order
            }) 
        } catch (error) {
            return res.status(500).json({ message: error.message })
        }
    }

    getRefundPayment = async (req, res, next) => {
        try {
            const vnp_Params = req.query;
            const secureHash = vnp_Params['vnp_SecureHash'];
    
            delete vnp_Params['vnp_SecureHash'];
            delete vnp_Params['vnp_SecureHashType'];
    
            const sortedParams = sortObject(vnp_Params);
    
            const signData = querystring.stringify(sortedParams, { encode: false });  
            
            const hmac = crypto.createHmac("sha512", process.env.vnp_HashSecret);
            const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
    
            if(secureHash === signed){
                const orderId = vnp_Params['vnp_TxnRef'];
                const rspCode = vnp_Params['vnp_ResponseCode'];
                
                if (rspCode === '00') {
                    // convert status of order ---> COMPLETE
                    const order = await Order.findOne({ where: { payment_id: orderId }})
                    order.status = StatusOrder.CANCEL;
                    await order.save()
                    
                    // update slot tour
                    const orderItems = await OrderItem.findAll({
                        where: {
                            order_id: order.order_id
                        }
                    })
                    for (const orderItem of orderItems) {
                        if (orderItem.is_updated_slot) {
                            const tourId = orderItem.tour_id
                            const tour = await findTourById(tourId)
                            if (!tour) {
                                return res.status(404).json({ 
                                    message: "Not found tour in order item!"
                                })
                            }
                            tour.current_customers -= orderItem.quantity
                            tour.booked_number -= orderItem.quantity
                            await tour.save()

                            redisClient.del("online_tours")
                            orderItem.is_updated_slot = false;
                            await orderItem.save()
                        }
                        else {
                            continue
                        }
                    }

                    return res.status(200).json({ RspCode: '00', Message: 'You pay for order successfully!' });
                } else {
                    // convert status of order ---> FAILED
                    const order = await Order.findOne({ where: { payment_id: orderId }})
                    order.status = StatusOrder.FAILED;
                    await order.save()

                    return res.status(200).json({ RspCode: rspCode, Message: 'Transaction failed' });
                }
            } else {
                return res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
            }
        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ message: "Internal server error" });
        }
    }

    // PAYMENT WITH MOMO
    paymentWithMomo = async (req, res, next) => {
        try {
            var partnerCode = process.env.PARTNER_CODE;
            var accessKey = process.env.ACCESS_KEY;
            var secretkey = process.env.SECRETKEY;
            var requestId = partnerCode + new Date().getTime();
            var orderId = requestId;
            var orderInfo = "pay with MoMo";
            var redirectUrl = "https://momo.vn/return";
            var ipnUrl = "https://callback.url/notify";
            var amount = "50000";
            var requestType = "captureWallet"
            var extraData = ""; 

            //before sign HMAC SHA256 with format
            //accessKey=$accessKey&amount=$amount&extraData=$extraData&ipnUrl=$ipnUrl&orderId=$orderId&orderInfo=$orderInfo&partnerCode=$partnerCode&redirectUrl=$redirectUrl&requestId=$requestId&requestType=$requestType
            var rawSignature = "accessKey="+accessKey+"&amount=" + amount+"&extraData=" + extraData+"&ipnUrl=" + ipnUrl+"&orderId=" + orderId+"&orderInfo=" + orderInfo+"&partnerCode=" + partnerCode +"&redirectUrl=" + redirectUrl+"&requestId=" + requestId+"&requestType=" + requestType

            //signature
            const crypto = require('crypto');
            var signature = crypto.createHmac('sha256', secretkey)
                .update(rawSignature)
                .digest('hex');

            //json object send to MoMo endpoint
            const requestBody = JSON.stringify({
                partnerCode : partnerCode,
                accessKey : accessKey,
                requestId : requestId,
                amount : amount,
                orderId : orderId,
                orderInfo : orderInfo,
                redirectUrl : redirectUrl,
                ipnUrl : ipnUrl,
                extraData : extraData,
                requestType : requestType,
                signature : signature,
                lang: 'en'
            });

           
            
            // options for axios
            const options = {
                method: 'POST',
                url: 'https://test-payment.momo.vn/v2/gateway/api/create',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody),
                },
                data: requestBody,
            };


            // Send the request and handle the response
            let result;
            result = await axios(options);
            console.log("1")
            return res.status(200).json(result.data);
    
        } catch (error) {
            return res.status(500).json({ message: error.message })
        }
    }
}

module.exports = new PaymentController()
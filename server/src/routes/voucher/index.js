'use strict'

const express = require("express")
const router = express.Router()
const { asyncHandler } = require('../../auth/checkAuth')
const voucherController = require("../../controllers/voucher.controller")
const formidableMiddleware = require('express-formidable');

router.use(formidableMiddleware());
router.post("", asyncHandler(voucherController.createVoucher))
router.get("/all", asyncHandler(voucherController.getAllVouchers))
router.get("/:voucher_id", asyncHandler(voucherController.getVoucher))
router.put("/:voucher_id", asyncHandler(voucherController.updateVoucher))
router.delete("/:voucher_id", asyncHandler(voucherController.deleteVoucher))

module.exports = router
const express = require("express");
const router = express.Router();
const { getBookings, getBooking, createBooking, updateBooking } = require("../controllers/workshopBookingController");
const { protect, optionalProtect, adminOnly } = require("../middleware/auth");

router.get("/", protect, adminOnly, getBookings);
router.get("/:id", getBooking);
router.post("/", optionalProtect, createBooking);
router.put("/:id", protect, adminOnly, updateBooking);

module.exports = router;

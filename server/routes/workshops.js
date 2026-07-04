const express = require("express");
const router = express.Router();
const { getWorkshops, getWorkshop, createWorkshop, updateWorkshop, deleteWorkshop } = require("../controllers/workshopController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", getWorkshops);
router.get("/:slug", getWorkshop);
router.post("/", protect, adminOnly, createWorkshop);
router.put("/:id", protect, adminOnly, updateWorkshop);
router.delete("/:id", protect, adminOnly, deleteWorkshop);

module.exports = router;

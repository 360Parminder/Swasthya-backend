const express = require("express");
const reminder_router = express.Router();

const user_auth = require("../../middleware/user_auth.js");

const {
    create_medication,
    delete_medication,
    update_medication,
    view_medication,
    view_all_medication,
    
} = require("../controllers/medication_controller.js");

reminder_router.post("/medication/create", user_auth, create_medication);

reminder_router.delete("/medication/delete", user_auth, delete_medication);

// reminder_router.post("/medication/update", user_auth, update_medication);

reminder_router.get("/medication/view", user_auth, view_medication);

reminder_router.get("/medication/view/all", user_auth, view_all_medication);



module.exports = reminder_router;
const mongoose = require("mongoose");
const medication_model = require("../models/medication_model");
const reminderModel = require("../models/reminder_model");
const { scheduleReminder } = require("../../public/utils/scheduler");
const User = require("../models/user_model");

exports.create_medication = async (req) => {
  const user_id = req.user._id;
  const {
    medicine_name,
    forms,
    strength,
    unit,
    frequency,
    times,
    start_date,
    end_date,
    description,
    forWhom,
    relative_id,
    stock,
  } = req.body;
  console.log("User ID in create_medication:", forWhom, relative_id);

  if (!user_id) {
    return { status: 404, success: false, message: "User not found" };
  }
  if (
    !medicine_name ||
    !forms ||
    !strength ||
    !unit ||
    !frequency ||
    !times ||
    !start_date
  ) {
    return {
      status: 400,
      success: false,
      message: "Missing required medication fields",
    };
  }
  if (!["myself", "connection"].includes(forWhom)) {
    return {
      status: 400,
      success: false,
      message: "forWhom must be either 'myself' or 'connection'",
    };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let targetUserId = user_id; // default to self
    let medForWhom = forWhom;
    let medRelativeId = null;
    console.log("Target User ID:", targetUserId);
    console.log("For Whom:", medForWhom);
    console.log("Relative ID:", medRelativeId);

    if (forWhom === "connection") {
      if (!relative_id) {
        await session.abortTransaction();
        session.endSession();
        return {
          status: 400,
          success: false,
          message: "Relative ID is required for relative medication",
        };
      }
      const relativeUser = await User.findOne({ userId: relative_id }).session(
        session
      );
      if (!relativeUser) {
        await session.abortTransaction();
        session.endSession();
        return {
          status: 404,
          success: false,
          message: "Relative user not found",
        };
      }
      targetUserId = relativeUser._id;
      medRelativeId = user_id; // who is adding for the relative
    }

    // Function to get image based on form type
    const getMedicationImage = (formType) => {
      const imageMap = {
        capsule: "https://example.com/images/medications/capsule.png",
        tablet: "https://example.com/images/medications/tablet.png",
        liquid: "https://example.com/images/medications/liquid.png",
        topical: "https://example.com/images/medications/topical.png",
        cream: "https://example.com/images/medications/cream.png",
        device: "https://example.com/images/medications/device.png",
        drops: "https://example.com/images/medications/drops.png",
        foam: "https://example.com/images/medications/foam.png",
        gel: "https://example.com/images/medications/gel.png",
        inhaler: "https://example.com/images/medications/inhaler.png",
        injection: "https://example.com/images/medications/injection.png",
        lotion: "https://example.com/images/medications/lotion.png",
        ointment: "https://example.com/images/medications/ointment.png",
        patch: "https://example.com/images/medications/patch.png",
        powder: "https://example.com/images/medications/powder.png",
        spray: "https://example.com/images/medications/spray.png",
        suppository: "https://example.com/images/medications/suppository.png",
      };

      return (
        imageMap[formType] ||
        "https://example.com/images/medications/default.png"
      );
    };

    // ADD "created_by" and medication image
    const medicationData = {
      medicine_name,
      forms,
      strength,
      unit,
      frequency,
      times,
      start_date,
      end_date,
      description: description || "",
      medication_image: getMedicationImage(forms), // Add image based on form type
      stock,
    };

    // Add medication (append, don't overwrite)
    let result = await medication_model.findOneAndUpdate(
      { user_id: targetUserId },
      {
        $push: { record: medicationData },
        created_by: user_id,
        relative_id: medRelativeId,
        forWhom: medForWhom,
      },
      { upsert: true, new: true, session }
    );

    console.log("Medication Result:", result);
    if (!result) {
      await session.abortTransaction();
      session.endSession();
      return {
        status: 500,
        success: false,
        message: "Failed to create or update medication record",
      };
    }

    await scheduleMedicationReminders([medicationData], targetUserId);

    await session.commitTransaction();
    session.endSession();
    return {
      status: 200,
      success: true,
      message: "Medication added successfully",
      data: result,
    };
  } catch (error) {
    console.log("Error in create_medication:", error);

    await session.abortTransaction();
    session.endSession();
    return {
      status: 500,
      success: false,
      message: "An error occurred while adding medication",
      error: error.message,
    };
  }
};

const scheduleMedicationReminders = async (medicationRecords, user_id) => {
  try {
    for (let medication of medicationRecords) {
      // Ensure forWhom is set to a default value if not present
      if (!medication.forWhom) {
        medication.forWhom = "self"; // Default to "self" if not specified
      }

      for (let timeEntry of medication.times) {
        //  let time =  convertUTCToIST(timeEntry.time);
        let time = timeEntry.time;
        let repeat = "none";
        if (medication.frequency.type === "As Needed") {
          repeat = "daily";
        }

        // Create or update reminder in the database
        let reminderEntry = await reminderModel.updateOne(
          { user_id: user_id },
          {
            $push: {
              reminder_info: {
                type: "medication",
                title: medication.medicine_name,
                message: `It's time to take your ${medication.medicine_name}`,
                time: time,
                repeat: repeat, // Adjust repeat logic based on your requirements
              },
            },
          },
          { upsert: true }
        );

        if (!reminderEntry) {
          console.error(
            `Failed to create/update reminder in the database for ${time}`
          );
          continue; // Skip to the next time entry if this fails
        }

        const reminder = await reminderModel.findOne({ user_id: user_id });

        scheduleReminder(reminder._id, {
          message: `It's time to take your ${medication.medicine_name}`,
          time: time,
          repeat: repeat, // Adjust repeat logic based on your requirements
        });
      }
    }
  } catch (error) {
    console.log(error);
  }
};

exports.view_medication = async (req, res) => {
  try {
    const user_id = req.user._id;
    console.log("User ID in view_medication:", user_id);

    const medication_id = new mongoose.Types.ObjectId(req.query.medication_id);
    let allMedication = await medication_model.findOne({ user_id: user_id });

    let queryMedication = {};
    allMedication.record.forEach((medication) => {
      if (medication._id.equals(medication_id)) {
        queryMedication = medication;
      }
    });
    if (!queryMedication) {
      return {
        status: 404,
        success: false,
        message: "Medication not found",
      };
    }
    return {
      status: 200,
      success: true,
      message: "Fetched Medication successfully",
      medication: queryMedication,
    };
  } catch (error) {
    console.log(error);

    return {
      status: 500,
      success: false,
      message: error.message,
    };
  }
};

exports.view_medication_by_date = async (req, res) => {
  try {
    const date = req.query.date;
    console.log("Date: ", date);
    const user_id = req.user._id;
    const allMedication = await medication_model.findOne({ user_id: user_id });

    if (!allMedication || !allMedication.record) {
      return {
        status: 200,
        success: true,
        message: "No medication found",
        medication: [],
      };
    }

    const targetDateStr = typeof date === "string" ? date.split("T")[0] : new Date(date).toISOString().split("T")[0];

    const queryMedication = allMedication.record.filter((medication) => {
      const startStr = medication.start_date ? new Date(medication.start_date).toISOString().split("T")[0] : null;
      const endStr = medication.end_date ? new Date(medication.end_date).toISOString().split("T")[0] : null;
      if (startStr && startStr > targetDateStr) return false;
      if (endStr && endStr < targetDateStr) return false;
      return true;
    });

    const result = queryMedication.map((medication) => {
      const medObj = medication.toObject ? medication.toObject() : { ...medication };
      if (medObj.logs) {
        medObj.logs = medObj.logs.filter((log) => {
          if (!log.time) return false;
          const logDateStr = new Date(log.time).toISOString().split("T")[0];
          return logDateStr === targetDateStr;
        });
      }
      return medObj;
    });

    return {
      status: 200,
      success: true,
      message: "Fetched Medication successfully",
      medication: result,
    };
  } catch (error) {
    console.log(error);
    return {
      status: 500,
      success: false,
      message: error.message,
    };
  }
};

exports.update_medication_status = async (req) => {
  try {
    const user_id = req.user._id;
    const { medication_id, status = "taken", time, dose_id } = req.body;

    if (!user_id) {
      return { status: 404, success: false, message: "User not found" };
    }

    if (!medication_id) {
      return { status: 400, success: false, message: "Medication ID is required" };
    }

    const validStatuses = ["taken", "skipped", "not taken yet"];
    if (!validStatuses.includes(status)) {
      return {
        status: 400,
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      };
    }

    // Find the medication document for this user
    let userMedication = await medication_model.findOne({ user_id: user_id });
    if (!userMedication || !userMedication.record) {
      return { status: 404, success: false, message: "Medication document not found" };
    }

    // Find the record by medication_id
    const medRecord = userMedication.record.find(
      (med) => med._id && med._id.toString() === medication_id.toString()
    );

    if (!medRecord) {
      return { status: 404, success: false, message: "Medication item not found" };
    }

    const logTime = time ? new Date(time) : new Date();
    const logDateStr = logTime.toISOString().split("T")[0];

    if (!medRecord.logs) {
      medRecord.logs = [];
    }

    // Check if there is an existing log for this date (and dose_id if given)
    const existingLogIndex = medRecord.logs.findIndex((log) => {
      const existingDateStr = log.time ? new Date(log.time).toISOString().split("T")[0] : null;
      if (existingDateStr !== logDateStr) return false;
      if (dose_id && log.dose_id) {
        return log.dose_id.toString() === dose_id.toString();
      }
      return true;
    });

    const prevStatus = existingLogIndex !== -1 ? medRecord.logs[existingLogIndex].status : "not taken yet";

    if (existingLogIndex !== -1) {
      medRecord.logs[existingLogIndex].status = status;
      medRecord.logs[existingLogIndex].logged = status === "taken";
      medRecord.logs[existingLogIndex].time = logTime;
      if (dose_id) {
        medRecord.logs[existingLogIndex].dose_id = dose_id;
      }
    } else {
      medRecord.logs.push({
        time: logTime,
        status: status,
        logged: status === "taken",
        dose_id: dose_id || null,
      });
    }

    // Handle stock adjustment
    if (medRecord.stock && typeof medRecord.stock.quantity === "number") {
      if (status === "taken" && prevStatus !== "taken") {
        medRecord.stock.quantity = Math.max(0, medRecord.stock.quantity - 1);
      } else if (status !== "taken" && prevStatus === "taken") {
        medRecord.stock.quantity = medRecord.stock.quantity + 1;
      }
    }

    // Ensure all existing records have a valid description string
    userMedication.record.forEach((rec) => {
      if (rec.description === undefined || rec.description === null) {
        rec.description = "";
      }
    });

    await userMedication.save();

    return {
      status: 200,
      success: true,
      message: `Medication marked as ${status}`,
      data: medRecord,
    };
  } catch (error) {
    console.error("Error in update_medication_status:", error);
    return {
      status: 500,
      success: false,
      message: error.message,
    };
  }
};

exports.update_medication = async (req) => {
  try {
    const user_id = req.user._id;
    const { medication_id, ...updates } = req.body;

    if (!user_id) {
      return { status: 404, success: false, message: "User not found" };
    }
    if (!medication_id) {
      return { status: 400, success: false, message: "Medication ID is required" };
    }

    let userMedication = await medication_model.findOne({ user_id: user_id });
    if (!userMedication || !userMedication.record) {
      return { status: 404, success: false, message: "Medication not found" };
    }

    const medIndex = userMedication.record.findIndex(
      (med) => med._id && med._id.toString() === medication_id.toString()
    );

    if (medIndex === -1) {
      return { status: 404, success: false, message: "Medication record not found" };
    }

    Object.assign(userMedication.record[medIndex], updates);

    // Ensure all existing records have a valid description string
    userMedication.record.forEach((rec) => {
      if (rec.description === undefined || rec.description === null) {
        rec.description = "";
      }
    });

    await userMedication.save();

    return {
      status: 200,
      success: true,
      message: "Medication updated successfully",
      data: userMedication.record[medIndex],
    };
  } catch (error) {
    console.error("Error in update_medication:", error);
    return {
      status: 500,
      success: false,
      message: error.message,
    };
  }
};

exports.view_all_medication = async (req, res) => {
  try {
    const user_id = req.user._id;
    const allMedication = await medication_model.find({ user_id: user_id });
    if (!allMedication) {
      return { success: false, message: "No Medication Found" };
    }
    return {
      success: true,
      medications: allMedication,
      message: "All Medications fetched succesfully",
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};

exports.delete_medication = async (req, res) => {
  try {
    const user_id = req.user._id;
    const medication_id = new mongoose.Types.ObjectId(req.query.medication_id);
    let allMedication = await medication_model.findOne({ user_id: user_id });

    if (!allMedication) {
      return {
        success: false,
        message: "Medication record not found",
      };
    }

    const medicationIndex = allMedication.record.findIndex((medication) =>
      medication._id.equals(medication_id)
    );

    if (medicationIndex === -1) {
      return {
        success: false,
        message: "Medication not found",
      };
    }

    allMedication.record.splice(medicationIndex, 1);
    await allMedication.save();

    return {
      success: true,
      message: "Deleted Medication successfully",
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};

const user_model = require("../models/user_model");
const mongoose = require("mongoose");

exports.send_request = async (req, res) => {
  try {
    const senderID = req.user._id;
    const receiverId = req.body.receiverId;

    let receiverData = await user_model.findOne({ userId: receiverId });

    // console.log(receiverData);
    if (!receiverData) {
      return {
        message: "Receiver not found",
        success: false,
      };
    }

    const existingRequest = receiverData.requests.find((request) =>
      request.sender_id.equals(senderID)
    );

    if (existingRequest) {
      return {
        message: "Request already sent",
        success: false,
      };
    }

    receiverData.requests.push({
      sender_id: senderID,
      status: "pending",
    });

    const updatedReceiverData = await receiverData.save();

    if (updatedReceiverData) {
      return {
        message: "Request sent successfully",
        success: true,
        data: updatedReceiverData.requests,
      };
    } else {
      return {
        message: "Request not sent",
        success: false,
      };
    }
  } catch (error) {
    // console.error(error);
    return {
      success: false,
      message: error.message,
    };
  }
};

exports.alluser = async (req, res) => {
  try {
    const user = await user_model.find();
    return {
      success: true,
      data: user,
    };
  } catch (error) {
    return {
      success: false,
      massege: error.massege,
    };
  }
};

exports.allRequest = async (req, res) => {
  try {
    const user_id = req.user._id;
    if (user_id) {
      const user_data = await user_model.findOne({ _id: user_id });

      // Populate sender's name for each request
      let allSenderData = [];
      for (const sender of user_data.requests) {
        let senderData = await user_model
          .findOne({ _id: sender.sender_id })
          .select("-password -auth_key -notificationToken")
          .exec();
        allSenderData.push(senderData);

      }
      return {
        success: true,
        message:"All Relatives' Requests fetched",
        data: allSenderData,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};

exports.update_Request = async (req, res) => {
  try {
    const user = req.user;
    const { senderId, status } = req.body;

    // Validate input
    if (!senderId || !mongoose.Types.ObjectId.isValid(senderId)) {
      return{
        status: 400,
        success: false,
        message: "Invalid sender ID",
      };
    }

    if (!["accepted", "rejected"].includes(status)) {
      return{
        status: 400,  
        success: false,
        message: "Status must be either 'accepted' or 'rejected'",
      };
    }

    // Find the request in user's requests array
    const requestIndex = user.requests.findIndex(request => 
      request.sender_id.equals(senderId) && request.status === "pending"
    );

    if (requestIndex === -1) {
      return{
        status: 404,  
        success: false,
        message: "Pending request not found",
      };
    }

    // Get sender data
    const sender = await user_model.findById(senderId);
    if (!sender) {
      return{
        status: 404,    
        success: false,
        message: "Sender not found",
      };
    }

    if (status === "accepted") {
      // ACCEPT REQUEST LOGIC
      // Check if already connected
      const alreadyConnected = user.connections.some(conn => 
        conn.equals(senderId)
      ) || sender.connections.some(conn => 
        conn.equals(user._id)
      );

      if (alreadyConnected) {
        return{
          status: 400,
          success: false,
          message: "Already connected with this user",
        };
      }

      // Add to each other's connections
      user.connections.push(senderId);
      sender.connections.push(user._id);

      // Update request status to accepted
      user.requests[requestIndex].status = "accepted";

      // Save both users
      await Promise.all([user.save(), sender.save()]);

      return {
        success: true,
        message: "Request accepted and connection established",
        data: {
          user,
          sender,
        },
      };
    } else {
      // REJECT REQUEST LOGIC
      
      // Update request status to rejected
      user.requests[requestIndex].status = "rejected";
      await user.save();

      return {
        status: 200,
        success: true,
        message: "Request rejected",
        data: {
          user,
        },
      };
    }
  } catch (error) {
    console.error("Error updating request:", error);
    return {
      status: 500,
      success: false,
      message: error.message || "Internal Server Error",
    };
  }
};
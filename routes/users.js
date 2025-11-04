// Load required packages
var User = require('../models/user');
var Task = require('../models/task');
var mongoose = require('mongoose');

module.exports = function (router) {
    // GET /api/users  -> Supports where, sort, select, skip, limit, count
    router.get('/users', async function (req, res) {
        try {
            function safeParse(str, fallback) {
                try { return JSON.parse(str); } catch (e) { return fallback; }
            }
            if (req.query.count === 'true') {
                var whereObj = req.query.where ? safeParse(req.query.where, {}) : {};
                var count = await User.countDocuments(whereObj);
                return res.status(200).json({ message: "OK", data: count });
            }
            var query = User.find();
            if (req.query.where)  query.find(safeParse(req.query.where, {}));
            if (req.query.sort)   query.sort(safeParse(req.query.sort, {}));
            if (req.query.select) query.select(safeParse(req.query.select, {}));
            if (req.query.skip)   query.skip(parseInt(req.query.skip));
            if (req.query.limit)  query.limit(parseInt(req.query.limit));
            var users = await query.exec();
            res.status(200).json({ message: "OK", data: users });
        } catch (err) {
            res.status(500).json({ message: "Error fetching users", data: [] });
        }
    });
    // POST /api/users  -> Create a new user
    router.post('/users', async function (req, res) {
        try {
            if (!req.body.name || !req.body.email)
                return res.status(400).json({ message: "Name and email required", data: [] });
            // prevent duplicates
            var existing = await User.findOne({ email: req.body.email });
            if (existing)
                return res.status(400).json({ message: "Email already exists", data: [] });

            var newUser = new User({
                name: req.body.name,
                email: req.body.email,
                pendingTasks: req.body.pendingTasks || []
            });
            var savedUser = await newUser.save();
            res.status(201).json({ message: "User created", data: savedUser });
        } catch (err) {
            res.status(400).json({ message: "Failed to create user", data: [] });
        }
    });
    // GET /api/users/:id  -> Get one user-> Supports ?select={"field":1}
    router.get('/users/:id', async function (req, res) {
        try {
            var query = User.findById(req.params.id);
            if (req.query.select) query.select(JSON.parse(req.query.select));
            var user = await query.exec();

            if (!user) return res.status(404).json({ message: "User not found", data: [] });
            res.status(200).json({ message: "OK", data: user });
        } catch (err) {
            res.status(400).json({ message: "Error fetching user", data: [] });
        }
    });
    // PUT /api/users/:id  -> Replace entire user
    router.put('/users/:id', async function (req, res) {
        try {
            if (!req.body.name || !req.body.email)
                return res.status(400).json({ message: "Name and email required", data: [] });

            var session = await mongoose.startSession();
            session.startTransaction();

            var user = await User.findById(req.params.id).session(session);
            if (!user) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ message: "User not found", data: [] });
            }
            // update user fields
            user.name = req.body.name;
            user.email = req.body.email;
            user.pendingTasks = req.body.pendingTasks || [];
            await user.save({ session });
            // sync pendingTasks with Task collection
            await Task.updateMany(
                { assignedUser: user._id },
                { $set: { assignedUser: "", assignedUserName: "unassigned" } },
                { session }
            );
            await Task.updateMany(
                { _id: { $in: user.pendingTasks } },
                { $set: { assignedUser: user._id.toString(), assignedUserName: user.name } },
                { session }
            );
            await session.commitTransaction();
            session.endSession();
            res.status(200).json({ message: "User updated", data: user });
        } catch (err) {
            res.status(400).json({ message: "Failed to update user", data: [] });
        }
    });
    // DELETE /api/users/:id  -> Delete a user -> Unassign any tasks that reference this user
    router.delete('/users/:id', async function (req, res) {
        try {
            var session = await mongoose.startSession();
            session.startTransaction();
            var user = await User.findById(req.params.id).session(session);
            if (!user) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ message: "User not found", data: [] });
            }
            await Task.updateMany(
                { assignedUser: req.params.id },
                { $set: { assignedUser: "", assignedUserName: "unassigned" } },
                { session }
            );
            await user.deleteOne({ session });
            await session.commitTransaction();
            session.endSession();
            res.status(200).json({ message: "User deleted", data: {} });
        } catch (err) {
            res.status(500).json({ message: "Failed to delete user", data: [] });
        }
    });
};

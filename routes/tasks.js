// Load required packages
var Task = require('../models/task');
var User = require('../models/user');
var mongoose = require('mongoose');

module.exports = function (router) {
    // GET /api/tasks -> List all tasks -> Supports: where, sort, select, skip, limit, count
    router.get('/tasks', async function (req, res) {
        try {
            // helper -> parse JSON query params
            function safeParse(str, fallback) {
                try {
                    return JSON.parse(str); 
                } 
                catch (e) { 
                    return fallback; 
                }
            }
            // handle count separately
            if (req.query.count === 'true') {
                var whereObj = req.query.where ? safeParse(req.query.where, {}) : {};
                var count = await Task.countDocuments(whereObj);
                return res.status(200).json({ message: "OK", data: count });
            }
            // Build Mongoose query dynamically
            var query = Task.find();
            // use the Mongoose query helpers
            if (req.query.where)  query.find(safeParse(req.query.where, {}));
            if (req.query.sort)   query.sort(safeParse(req.query.sort, {}));
            if (req.query.select) query.select(safeParse(req.query.select, {}));
            if (req.query.skip)   query.skip(parseInt(req.query.skip));
            if (req.query.limit)  query.limit(parseInt(req.query.limit));
            else query.limit(100); // default limit to 100
            // execute the query
            var tasks = await query.exec();
            // respond with the tasks
            res.status(200).json({ message: "OK", data: tasks });
        } catch (err) {
            res.status(500).json({ message: "Error fetching tasks", data: [] });
        }
    });
    // POST /api/tasks -> Create a new task
    router.post('/tasks', async function (req, res) {
        try {
            // make sure required fields are present (name and deadline)
            if (!req.body.name || !req.body.deadline)
                return res.status(400).json({ message: "Task name and deadline required", data: [] });
            // create the task
            var newTask = new Task({
                name: req.body.name,
                description: req.body.description || "",
                deadline: req.body.deadline,
                completed: req.body.completed || false,
                assignedUser: req.body.assignedUser || "",
                assignedUserName: req.body.assignedUserName || "unassigned"
            });
            // transaction-like behavior -> if assignedUser exists, push task to user's pendingTasks
            var session = await mongoose.startSession();
            session.startTransaction();
            var savedTask = await newTask.save({ session });
            if (savedTask.assignedUser) {
                var user = await User.findById(savedTask.assignedUser).session(session);
                if (user) {
                    await User.updateOne(
                        { _id: user._id },
                        { $addToSet: { pendingTasks: savedTask._id.toString() } },
                        { session }
                    );
                    savedTask.assignedUserName = user.name;
                    await savedTask.save({ session });
                } else {
                    savedTask.assignedUser = "";
                    savedTask.assignedUserName = "unassigned";
                    await savedTask.save({ session });
                }
            }
            await session.commitTransaction();
            session.endSession();
            res.status(201).json({ message: "Task created", data: savedTask });

        } catch (err) {
            res.status(400).json({ message: "Failed to create task", data: [] });
        }
    });
    // GET /api/tasks/:id  -> Get one task
    router.get('/tasks/:id', async function (req, res) {
        try {
            var query = Task.findById(req.params.id);
            if (req.query.select) query.select(JSON.parse(req.query.select));
            var task = await query.exec();
            if (!task) return res.status(404).json({ message: "Task not found", data: [] });
            res.status(200).json({ message: "OK", data: task });
        } catch (err) {
            res.status(400).json({ message: "Error fetching task", data: [] });
        }
    });
    // PUT /api/tasks/:id  -> Replace entire task
    router.put('/tasks/:id', async function (req, res) {
        try {
            if (!req.body.name || !req.body.deadline)
                return res.status(400).json({ message: "Task name and deadline required", data: [] });

            var session = await mongoose.startSession();
            session.startTransaction();

            var oldTask = await Task.findById(req.params.id).session(session);
            if (!oldTask) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ message: "Task not found", data: [] });
            }
            // remove old task link from previous user if changed
            if (oldTask.assignedUser && oldTask.assignedUser !== req.body.assignedUser) {
                await User.updateOne(
                    { _id: oldTask.assignedUser },
                    { $pull: { pendingTasks: oldTask._id.toString() } },
                    { session }
                );
            }
            // update task data
            var updatedTask = await Task.findOneAndUpdate(
                { _id: req.params.id },
                {
                    name: req.body.name,
                    description: req.body.description || "",
                    deadline: req.body.deadline,
                    completed: req.body.completed || false,
                    assignedUser: req.body.assignedUser || "",
                    assignedUserName: req.body.assignedUserName || "unassigned",
                    dateCreated: oldTask.dateCreated
                },
                { new: true, overwrite: true, runValidators: true, session }
            );
            // if assignedUser provided, sync with User collection
            if (updatedTask.assignedUser) {
                var user = await User.findById(updatedTask.assignedUser).session(session);
                if (user) {
                    await User.updateOne(
                        { _id: user._id },
                        { $addToSet: { pendingTasks: updatedTask._id.toString() } },
                        { session }
                    );
                    updatedTask.assignedUserName = user.name;
                    await updatedTask.save({ session });
                } else {
                    updatedTask.assignedUser = "";
                    updatedTask.assignedUserName = "unassigned";
                    await updatedTask.save({ session });
                }
            }
            await session.commitTransaction();
            session.endSession();
            res.status(200).json({ message: "Task updated", data: updatedTask });
        } catch (err) {
            res.status(400).json({ message: "Failed to update task", data: [] });
        }
    });
    // DELETE /api/tasks/:id  -> Delete a task
    router.delete('/tasks/:id', async function (req, res) {
        try {
            var session = await mongoose.startSession();
            session.startTransaction();

            var task = await Task.findById(req.params.id).session(session);
            if (!task) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ message: "Task not found", data: [] });
            }
            if (task.assignedUser) {
                await User.updateOne(
                    { _id: task.assignedUser },
                    { $pull: { pendingTasks: task._id.toString() } },
                    { session }
                );
            }
            await task.deleteOne({ session });
            await session.commitTransaction();
            session.endSession();
            res.status(200).json({ message: "Task deleted", data: {} });
        } catch (err) {
            res.status(500).json({ message: "Failed to delete task", data: [] });
        }
    });
};

const express = require("express");
const https = require("https");
const app = express();
app.set("trust proxy", 1); // trust first proxy
app.use(
    session({
        secret: process.env.JWT_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: true,
            sameSite: "none",
        },
    })
);
const server = https.createServer(app);
const socket = require("socket.io");
const io = socket(server);

const users = {};
const ACTIVE_TIMEOUT = 10000;

io.on('connection', socket => {
    // Add the user to the list of users
    users[socket.id] = socket.id;
    io.sockets.emit("allUsers", users);

    socket.on('disconnect', () => {
        delete users[socket.id]; // Remove user based on socket ID
        io.sockets.emit("allUsers", users);
    });

    // Emit user's ID and the list of all users
    socket.emit("yourID", socket.id);

    // Handle call events
    socket.on("callUser", (data) => {
        io.to(data.userToCall).emit('hey', { signal: data.signalData, from: data.from });
    });

    socket.on("acceptCall", (data) => {
        io.to(data.to).emit('callAccepted', data.signal);
    });

    // Handle user-initiated disconnection event
    socket.on('userDisconnect', (userId) => {
        delete users[userId];
        io.sockets.emit("allUsers", users);
    });

    // Handle unexpected disconnection
    socket.on('disconnect', () => {
        delete users[socket.id];
        io.sockets.emit("allUsers", users);
    });
    // Regularly clean up inactive users
    setInterval(() => {
        const now = new Date();
        for (const id in users) {
            if (now - users[id].lastActive > ACTIVE_TIMEOUT) {
                delete users[id];
            }
        }
        io.sockets.emit("allUsers", getActiveUsers());
    }, ACTIVE_TIMEOUT);
});

function getActiveUsers() {
    return Object.keys(users).reduce((acc, id) => {
        acc[id] = { lastActive: users[id].lastActive };
        return acc;
    }, {});
}

server.listen(3000, () => console.log('server is running on port 3000'));

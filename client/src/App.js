import React, { useEffect, useState, useRef } from 'react';
import './App.css';
import io from "socket.io-client";
import Peer from "simple-peer";

function App() {
    const [yourID, setYourID] = useState("");
    const [users, setUsers] = useState({});
    const [stream, setStream] = useState();
    const [receivingCall, setReceivingCall] = useState(false);
    const [caller, setCaller] = useState("");
    const [callerSignal, setCallerSignal] = useState();
    const [callAccepted, setCallAccepted] = useState(false);
    const [message, setMessage] = useState(""); // Current message being typed
    const [receivedMessages, setReceivedMessages] = useState([]); // Array of received messages

    const userVideo = useRef();
    const partnerVideo = useRef();
    const socket = useRef();
    const peerRef = useRef(); // Ref for peer instance
    const dataChannelRef = useRef(); // Ref for data channel

    useEffect(() => {
        socket.current = io.connect("/");
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            setStream(stream);
            if (userVideo.current) {
                userVideo.current.srcObject = stream;
            }
        })

        socket.current.on("yourID", (id) => {
            setYourID(id);
        })
        socket.current.on("allUsers", (users) => {
            setUsers(users);
        })

        socket.current.on("hey", (data) => {
            setReceivingCall(true);
            setCaller(data.from);
            setCallerSignal(data.signal);
        })

        socket.current.on("callEnded", endCall);

        return () => {
            if (peerRef.current) {
                peerRef.current.destroy();
            }
            socket.current.off("callEnded", endCall);
        };
    }, []);

    const endCall = () => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        setCallAccepted(false);
        setReceivingCall(false);
        setCaller("");
        setCallerSignal(null);
    };

    function callPeer(id) {
        const peer = new Peer({
            initiator: true,
            trickle: false,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    // Add TURN server here if you have one
                ]
            },
            stream: stream,
        });

        // Create a data channel
        peer.on('connect', () => {
            dataChannelRef.current = peer;
        });

        // Handle incoming messages
        peer.on('data', handleMessageReceive);

        peer.on("signal", data => {
            socket.current.emit("callUser", { userToCall: id, signalData: data, from: yourID })
        })

        peer.on("stream", stream => {
            if (partnerVideo.current) {
                partnerVideo.current.srcObject = stream;
            }
        });

        socket.current.on("callAccepted", signal => {
            setCallAccepted(true);
            peer.signal(signal);
        })

        peerRef.current = peer; // Set the peerRef to the current peer
    }

    function acceptCall() {
        setCallAccepted(true);
        const peer = new Peer({
            initiator: false,
            trickle: false,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                ]
            },
            stream: stream,
        });

        // Create a data channel
        peer.on('connect', () => {
            dataChannelRef.current = peer;
        });

        // Handle incoming messages
        peer.on('data', handleMessageReceive);

        peer.on("signal", data => {
            if (!peer.destroyed) {
                socket.current.emit("acceptCall", { signal: data, to: caller });
            }
        });

        peer.on("stream", stream => {
            partnerVideo.current.srcObject = stream;
        });

        if (!peer.destroyed) {
            peer.signal(callerSignal);
        }
        peerRef.current = peer;
    }

    const handleMessageReceive = (data) => {
        setReceivedMessages(oldMsgs => [...oldMsgs, data.toString()]);
    };

    const sendMessage = () => {
        if (dataChannelRef.current && message !== "") {
            dataChannelRef.current.send(message);
            setReceivedMessages(oldMsgs => [...oldMsgs, `You: ${message}`]);
            setMessage("");
        }
    };


    let UserVideo;
    if (stream) {
        UserVideo = (
            <video playsInline muted ref={userVideo} autoPlay />
        );
    }

    let PartnerVideo;
    if (callAccepted) {
        PartnerVideo = (
            <video playsInline ref={partnerVideo} autoPlay />
        );
    }

    let incomingCall;
    if (receivingCall) {
        incomingCall = (
            <div>
                <h1>{caller} is calling you</h1>
                <button onClick={acceptCall}>Accept</button>
            </div>
        )
    }

    const handleKeyPress = (e) => {
        // Check if the pressed key is 'Enter'
        if (e.key === 'Enter') {
            sendMessage();
        }
    };

    return (
        <div className="container">
            <div className="title-section">
                <h1 className="title">ChatSolid</h1>
                <p className="subtitle">By Eli Van Stichelen</p>
            </div>
            <div className=" video-group">
                <div className="user-video video-wrapper">
                    {UserVideo}
                </div>
                <div className="partner-video video-wrapper">
                    {PartnerVideo}
                </div>
            </div>
            <div className='dashboard-row'>
                <div className="row sessions">
                    {Object.keys(users).length > 0 && (
                        (() => {
                            const latestUserKey = Object.keys(users)[Object.keys(users).length - 1];
                            if (latestUserKey === yourID) {
                                return null;
                            }
                            return (
                                <button className="call-button" onClick={() => callPeer(latestUserKey)}>
                                    Call {latestUserKey}
                                </button>
                            );
                        })()
                    )}
                </div>
                <div className="chat-session">
                    <div className="title-section chat-title">
                        <h2>Solid Chat</h2>
                    </div>
                    <div className="chat-messages">
                        {receivedMessages.map((msg, index) => (
                            <p key={index}>{msg}</p>
                        ))}
                    </div>
                    <div className='default-col'>
                        <input
                            className="chat-input"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyPress={handleKeyPress}
                            type="text"
                            placeholder="Type message here..."
                        />
                        <button className="chat-button" onClick={sendMessage}>Send</button>
                    </div>
                </div>
                <div className="row sessions">

                </div>
            </div>
            {incomingCall && !callAccepted && <div className="row incoming-call">
                {incomingCall}
            </div>}
        </div>
    );
}

export default App;
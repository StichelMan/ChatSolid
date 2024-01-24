import React, { useEffect, useState, useRef } from 'react';
import './App.css';
import io from "socket.io-client";
import Peer from "simple-peer";
import {fetch, getDefaultSession, handleIncomingRedirect, login} from "@inrupt/solid-client-authn-browser";
import {
    addStringNoLocale,
    addUrl,
    createSolidDataset,
    createThing,
    getPodUrlAll,
    getSolidDataset, getStringNoLocale, getThing,
    getThingAll,
    removeThing,
    saveSolidDatasetAt,
    setThing
} from "@inrupt/solid-client";
import {AS, RDF, SCHEMA_INRUPT} from "@inrupt/vocab-common-rdf";

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
    const [webID, setWebID] = useState(""); // WebID of the user
    const [isLoggedIn, setIsLoggedIn] = useState(false); // Authentication status

    const userVideo = useRef();
    const partnerVideo = useRef();
    const socket = useRef();
    const peerRef = useRef(); // Ref for peer instance
    const dataChannelRef = useRef(); // Ref for data channel

    const CHAT_FILE_PATH = "/chats/";

    async function saveChatToPod(webID, chatContent) {
        const podUrl = new URL(CHAT_FILE_PATH, webID).href;
        let chatDataset;
        try {
            chatDataset = await getSolidDataset(podUrl, { fetch: fetch });
        } catch (error) {
            if (error.statusCode === 404) {
                chatDataset = createSolidDataset();
            } else {
                throw error;
            }
        }

        let chatThing = createThing({ name: "chat" });
        chatThing = addStringNoLocale(chatThing, SCHEMA_INRUPT.text, JSON.stringify(chatContent));
        chatDataset = setThing(chatDataset, chatThing);

        await saveSolidDatasetAt(podUrl, chatDataset, { fetch: fetch });
    }

    async function fetchChatFromPod(webID) {
        const podUrl = new URL(CHAT_FILE_PATH, webID).href;
        try {
            const chatDataset = await getSolidDataset(podUrl, { fetch: fetch });
            const chatThing = getThing(chatDataset, `${podUrl}#chat`);
            const chatContent = getStringNoLocale(chatThing, SCHEMA_INRUPT.text);
            return JSON.parse(chatContent);
        } catch (error) {
            if (error.statusCode === 404) {
                return []; // Return an empty array if chat file doesn't exist
            } else {
                throw error;
            }
        }
    }







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

        peer.on('connect', async () => {
            dataChannelRef.current = peer;
            if (isLoggedIn) {
                const chatHistory = await fetchChatFromPod(webID);
                setReceivedMessages(chatHistory);
            }
        });

        peer.on('data', handleMessageReceive);
        // Create a data channel
        peer.on('connect', () => {
            dataChannelRef.current = peer;
        });
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

    const handleLogin = async () => {
        const oidcIssuer = 'https://login.inrupt.com';
        const redirectUrl = window.location.href;
        await login({ oidcIssuer, redirectUrl });
    };

    useEffect(() => {
        (async () => {
            await handleIncomingRedirect();
            const session = getDefaultSession();
            if (session.info.isLoggedIn) {
                setWebID(session.info.webId);
                setIsLoggedIn(true);
            }
        })();
    }, []);

    return (
        <div className="container">
            <div className="title-section">
                <h1 className="title">ChatSolid</h1>
                <p className="subtitle">By Eli Van Stichelen</p>
            </div>
            {!isLoggedIn ? (
                <div className="auth-section">
                    <h3>Login with Solid</h3>
                    <button onClick={handleLogin}>Login with Inrupt</button>
                </div>
            ) : (
                <div>
                    <p>Logged in as: {webID}</p>
                </div>
            )}
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
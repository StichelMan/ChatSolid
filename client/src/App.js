import React, {useEffect, useState, useRef} from 'react';
import './App.css';
import io from "socket.io-client";
import Peer from "simple-peer";
import {SessionProvider, LoginButton, LogoutButton, useSession} from "@inrupt/solid-ui-react";
import {
    getSolidDataset,
    setThing,
    createSolidDataset,
    saveSolidDatasetAt,
    createThing,
    addStringNoLocale,
    getStringNoLocale, getThing
} from "@inrupt/solid-client";
import {FOAF, SCHEMA_INRUPT} from "@inrupt/vocab-common-rdf";

const AuthSection = () => {
    const {session} = useSession();
    const webId = session?.info?.webId;

    return (
        <div className='authentication-section'>
            <span>Logged in as: <span className='bold'>{webId || 'N/A'}</span></span>
            {session?.info?.isLoggedIn ? (
                <div className='logout-button'>
                    <LogoutButton

                        onLogout={() => console.log("Logged out")}
                        onError={(error) => console.error(error)}
                    >
                        Log Out
                    </LogoutButton>
                </div>
            ) : (
                <div className='login-button'>
                    <LoginButton
                        oidcIssuer="https://inrupt.net"
                        redirectUrl="http://localhost:3000/chatsolid"
                    >
                        Log In
                    </LoginButton>
                </div>
            )}
        </div>
    );
};

function App() {
    const {session} = useSession();
    const [yourID, setYourID] = useState('');
    const [users, setUsers] = useState({});
    const [stream, setStream] = useState(null);
    const [receivingCall, setReceivingCall] = useState(false);
    const [caller, setCaller] = useState('');
    const [callerSignal, setCallerSignal] = useState(null);
    const [sendingRequest, setSendingRequest] = useState(false);
    const [callAccepted, setCallAccepted] = useState(false);
    const [message, setMessage] = useState('');
    const [receivedMessages, setReceivedMessages] = useState([]);
    const [userName, setUserName] = useState('');

    const userVideo = useRef(null);
    const partnerVideo = useRef(null);
    const socket = useRef(null);
    const peerRef = useRef(null);
    const dataChannelRef = useRef(null);

    useEffect(() => {
        setupSocketConnection();
    }, [session?.info?.isLoggedIn, session?.info?.webId, session]);

    const setupSocketConnection = () => {
        socket.current = io.connect("/");
        socket.current.on("yourID", (id) => {
            const identifier = id;
            setYourID(identifier);
            socket.current.emit('identifyUser', identifier);
        });

        socket.current.on("allUsers", (users) => {
            setUsers(users);
            console.log("All Users: ", users);
        });
    };

    useEffect(() => {
        socket.current = io.connect("/");
        socket.current.on("yourID", (id) => {
            setYourID(id);
        });

        socket.current.on("allUsers", (users) => {
            setUsers(users);
        });

        socket.current.on("hey", (data) => {
            setReceivingCall(true);
            setCaller(data.from);
            setCallerSignal(data.signal);
        })

        socket.current.on("callEnded", endCall);


        // Get user media and set stream
        navigator.mediaDevices.getUserMedia({video: true, audio: true}).then((stream) => {
            setStream(stream);
            if (userVideo.current) {
                userVideo.current.srcObject = stream;
            }
        });

        // Clean up socket.io connection when unmounting
        return () => {
            if (socket.current) {
                socket.current.disconnect();
            }
            if (peerRef.current) {
                peerRef.current.destroy();
            }
        };
    }, []);

    const handleSetUserName = () => {
        if (!userName) return;
        const identifier = session?.info?.isLoggedIn ? session?.info?.webId : yourID;
        socket.current.emit('setUserInfo', {id: identifier, name: userName});
    };

    const endCall = () => {
        if (peerRef.current) {
            peerRef.current.destroy();
        }
        peerRef.current = null; // Reset the peerRef to null after destroying the peer
        setSendingRequest(false);
        setCallAccepted(false);
        setReceivingCall(false);
        setCaller("");
        setCallerSignal(null);
    };


    function callPeer(id) {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        setSendingRequest(true);
        const peer = new Peer({
            initiator: true,
            trickle: false,
            config: {
                iceServers: [{urls: "stun:stun.l.google.com:19302"}]
            },
            stream: stream,
        });

        peer.on("signal", data => {
            if (peerRef.current && !peerRef.current.destroyed) {
                socket.current.emit("callUser", {userToCall: id, signalData: data, from: yourID});
            }
        });

        // Create a data channel
        peer.on('connect', () => {
            dataChannelRef.current = peer;
        });

        // Handle incoming messages
        peer.on('data', handleMessageReceive);

        peer.on("stream", stream => {
            if (partnerVideo.current) {
                partnerVideo.current.srcObject = stream;
            }
        });

        socket.current.on("callAccepted", signal => {
            try {
                setCallAccepted(true);
                peerRef.current.signal(signal);
            } catch (e) {
                console.error(e);
            }

        });

        peer.on('close', () => {
            console.log("Peer connection closed");
            endCall();
        });

        peer.on("error", err => {
            console.error("Peer Connection Error:", err);
            endCall();
        });

        peerRef.current = peer; // Set the peerRef to the current peer
    }

    function acceptCall() {
        // Clean up any existing peer connection
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }

        setCallAccepted(true);
        const peer = new Peer({
            initiator: false,
            trickle: false,
            config: {
                iceServers: [{urls: "stun:stun.l.google.com:19302"}]
            },
            stream: stream,
        });

        peer.on("signal", data => {
            if (!peer.destroyed) {
                socket.current.emit("acceptCall", {signal: data, to: caller});
            }
        });

        // Create a data channel
        peer.on('connect', () => {
            dataChannelRef.current = peer;
        });

        // Handle incoming messages
        peer.on('data', handleMessageReceive);

        peer.on("stream", stream => {
            partnerVideo.current.srcObject = stream;
        });

        peer.on('close', () => {
            console.log("Peer connection closed");
            endCall();
        });


        if (!peer.destroyed) {
            peer.signal(callerSignal);
        }
        peer.on("error", err => {
            console.error("Peer Connection Error:", err);
            endCall();
        });
        peerRef.current = peer;
    }

    const CHAT_FILE_PATH = "/ChatSolid/chats/messages.ttl";

    // Function to save a message to the user's Solid pod
    const saveMessageToPod = async (message, isOutgoing) => {
        if (!session.info.isLoggedIn) return;
        const storageUrl = new URL(CHAT_FILE_PATH, session.info.webId).toString();

        try {
            let dataset;
            try {
                dataset = await getSolidDataset(storageUrl, {fetch: session.fetch});
            } catch (error) {
                // If the dataset does not exist, create a new one
                dataset = createSolidDataset();
            }

            const newMessageThing = createThing({name: `message-${new Date().toISOString()}`});
            const updatedMessageThing = addStringNoLocale(
                newMessageThing, FOAF.name, `${isOutgoing ? "You" : "Other"}: ${message}`
            );

            const updatedDataset = setThing(dataset, updatedMessageThing);
            await saveSolidDatasetAt(storageUrl, updatedDataset, {fetch: session.fetch});
        } catch (error) {
            console.error("Error saving message to Solid pod:", error);
        }
    };

    const sendMessage = () => {
        if (dataChannelRef.current && message !== "") {
            dataChannelRef.current.send(message);
            setReceivedMessages(oldMsgs => [...oldMsgs, `You: ${message}`]);
            saveMessageToPod(message, true); // Save the outgoing message
            setMessage("");
        }
    };

    const handleMessageReceive = (data) => {
        const receivedMessage = data.toString();
        setReceivedMessages(oldMsgs => [...oldMsgs, receivedMessage]);
        saveMessageToPod(receivedMessage, false); // Save the incoming message
    };


    async function saveChatToPod(webID, chatContent) {
        const podUrl = new URL(CHAT_FILE_PATH, webID).href;
        let chatDataset;
        try {
            chatDataset = await getSolidDataset(podUrl, {fetch: fetch});
        } catch (error) {
            if (error.statusCode === 404) {
                chatDataset = createSolidDataset();
            } else {
                throw error;
            }
        }

        let chatThing = createThing({name: "chat"});
        chatThing = addStringNoLocale(chatThing, SCHEMA_INRUPT.text, JSON.stringify(chatContent));
        chatDataset = setThing(chatDataset, chatThing);

        await saveSolidDatasetAt(podUrl, chatDataset, {fetch: fetch});
    }

    async function fetchChatFromPod(webID) {
        const podUrl = new URL(CHAT_FILE_PATH, webID).href;
        try {
            const chatDataset = await getSolidDataset(podUrl, {fetch: fetch});
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

    let UserVideo;
    if (stream) {
        UserVideo = (
            <video playsInline muted ref={userVideo} autoPlay/>
        );
    }
    let callStatus
    let PartnerVideo;
    if (callAccepted) {
        PartnerVideo = (
            <video playsInline ref={partnerVideo} autoPlay/>
        );
        callStatus = (
            'Connected'
        );
    } else {
        PartnerVideo = (
            ''
        );
    }


    if (stream && !callAccepted && (receivingCall || sendingRequest)) {
        callStatus = (
            'Waiting...'
        );
    }

    let incomingCall;
    if (receivingCall) {
        incomingCall = (
            <div className="callpopup-wrapper">
                <h1>{caller} is calling you</h1>
                <button className="action-button" onClick={acceptCall}>Accept</button>
            </div>
        )
        callStatus = (
            'Waiting...'
        );
    }

    const handleKeyPress = (e) => {
        // Check if the pressed key is 'Enter'
        if (e.key === 'Enter') {
            sendMessage();
        }
    };

    useEffect(() => {
        const identifier = session?.info?.isLoggedIn ? session?.info?.webId : yourID;
        if (socket.current && identifier) {
            socket.current.emit('identifyUser', identifier);
        }
    }, [session?.info?.isLoggedIn, session?.info?.webId, yourID]);

    useEffect(() => {
        return () => {
            socket.current.emit('userDisconnect', yourID);
            if (peerRef.current) {
                peerRef.current.destroy();
            }
        };
    }, [yourID]);

    useEffect(() => {
        // Send the authenticated WebID to other users when available
        if (session?.info?.isLoggedIn) {
            const identifier = session?.info?.webId;
            if (socket.current && identifier) {
                socket.current.emit('sendWebID', {id: yourID, webId: identifier});
            }
        }
    }, [session?.info?.isLoggedIn, yourID]);

    // Update the renderCallButtons function
    const renderCallButtons = () => {
        if (Object.keys(users).length <= 1) return (<p>No other users online</p>);
        if (receivingCall || callAccepted || sendingRequest) return (
            <>
                <p>{!callAccepted ? callStatus : 'Connected'}</p>
                <button className='action-button' onClick={() => endCall()}>
                    <span className='bold'>Disconnect</span>
                </button>
            </>
        );
        return Object.keys(users).map(key => {
            if (key === yourID) return null;
            return (
                <button key={key} className='call-button' onClick={() => callPeer(key)}>
                    <span className='bold'>Call User</span><br/> {key}
                </button>
            );
        });
    };

    return (
        <SessionProvider sessionId="solid-chat-session">
            <div className="container">
                <div className="title-section">
                    <h1 className="title">ChatSolid</h1>
                    <p className="subtitle">By Eli Van Stichelen</p>
                </div>
                <div className="video-group">
                    {/*{stream && session?.info?.isLoggedIn && <p>WebID: {yourID}</p>}*/}
                    <div className="user-video video-wrapper">
                        {UserVideo}
                        {/*{callAccepted ? UserVideo : ''}*/}
                        <p className="user-label">Me</p>
                    </div>
                    {/*{stream && session?.info?.isLoggedIn && <p>WebID: {yourID}</p>}*/}
                    <div className={"partner-video video-wrapper" + (!callAccepted ? " disabled" : "")}>
                        {PartnerVideo}
                        <p className="user-label">Other user</p>
                        {!callAccepted && (
                            <div className="no-session">
                                No current session
                            </div>
                        )}
                    </div>
                </div>
                <div className='dashboard-row'>
                    <div className="info">
                        {renderCallButtons()}
                    </div>
                    <div className={"chat-session" + (!callAccepted ? " disabled" : "")}>
                        <div className="title-section chat-title">
                            <h2>Solid Chat</h2>
                        </div>
                        <div className="chat-messages">
                            {receivedMessages.map((msg, index) => (
                                <p key={index}>{msg}</p>
                            ))}
                        </div>
                        <div className="input-actions">
                            <input
                                className="input"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                onKeyPress={handleKeyPress}
                                type="text"
                                placeholder="Type message here..."
                            />
                            <button className='action-button' onClick={sendMessage}>Send</button>
                        </div>
                        {!callAccepted && (
                            <div className="no-session">
                                No current session
                            </div>
                        )}
                    </div>
                    <div className="info">
                        <AuthSection/>
                        <p className="bold overflow-breakword">Current User ID:<br/> {yourID}</p>
                        <div className="input-actions">
                            <input className="input" type="text" placeholder="Enter your name" value={userName}
                                   onChange={(e) => setUserName(e.target.value)}/>
                            <button className="action-button" onClick={handleSetUserName}>Set Name</button>
                        </div>
                    </div>
                </div>
                {incomingCall && !callAccepted &&
                    <div className="incoming-call">
                        <div className="callpopup-wrapper">
                            <h1>{caller} is calling you</h1>
                            <button className="action-button" onClick={acceptCall}>Accept</button>
                        </div>
                    </div>
                }
            </div>
        </SessionProvider>
    );
}

export default App;
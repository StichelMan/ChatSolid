import React, {useEffect, useState, useRef} from 'react';
import './App.css';
import io from "socket.io-client";
import Peer from "simple-peer";
import {SessionProvider, LoginButton, LogoutButton, useSession} from "@inrupt/solid-ui-react";
import {
    getSolidDataset,
    setThing,
    saveSolidDatasetAt,
    createThing,
    addStringNoLocale,
    createSolidDataset
} from "@inrupt/solid-client";
import {FOAF} from "@inrupt/vocab-common-rdf";
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
    const [webId, setWebId] = useState('');
    const [partnerWebId, setPartnerWebId] = useState('');

    const userVideo = useRef(null);
    const partnerVideo = useRef(null);
    const socket = useRef(null);
    const peerRef = useRef(null);
    const dataChannelRef = useRef(null);
    const identityChannelRef = useRef(null);

    useEffect(() => {
        if (partnerWebId && webId){
            fetchChatHistory(partnerWebId) // Replace 'partnerWebId' with the actual WebID of the partner
                .then(history => setReceivedMessages(history));
        }

    }, [partnerWebId]);

    useEffect(() => {
        setWebId(session?.info?.webId)
        setupSocketConnection();
    }, []);

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

    useEffect(() => {
        setWebId(session?.info?.webId)
        // Send the authenticated WebID to other users when available
        if (session?.info?.isLoggedIn) {
            const identifier = session?.info?.webId;
            if (socket.current && identifier) {
                socket.current.emit('sendWebID', {id: yourID, webId: identifier});
            }
        }
    }, [session?.info?.isLoggedIn, yourID]);

    const setupSocketConnection = () => {
        socket.current = io.connect("/");
        socket.current.on("yourID", (id) => {
            setYourID(id); // Use session ID as primary identifier
            socket.current.emit('identifyUser', id);
        });

        socket.current.on("allUsers", (users) => {
            setUsers(users);
        });
    };

    const handleSetUserName = () => {
        if (!userName) return;
        socket.current.emit('setUserInfo', {id: yourID, name: userName}); // Use session ID
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

        peer.on('connect', () => {
            dataChannelRef.current = peer;
            if (session?.info?.isLoggedIn) {
                dataChannelRef.current.send(JSON.stringify({ webId: session.info.webId }));
            }

            if (partnerWebId) {
                dataChannelRef.current.send(JSON.stringify({ webId: session.info.webId, chatHistory: receivedMessages }));
            }

            // setPartnerWebId(session?.info?.webId)
            identityChannelRef.current = peer;
            identityChannelRef.current.send(webId);
            // identityChannelRef.current.send(receivedMessages)
            // Fetch chat history when the connection is established
            // fetchChatHistory(formatWebIdForFilename(partnerWebId)) // Replace 'partnerWebId' with the actual WebID of the partner
            //     .then(history => setReceivedMessages(history));
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

        peer.on('connect', () => {
            dataChannelRef.current = peer;
            if (session?.info?.isLoggedIn) {
                dataChannelRef.current.send(JSON.stringify({ webId: session.info.webId, chatHistory: receivedMessages})); //dunno what to do with this pfft
            }


            // setPartnerWebId(session?.info?.webId)
            identityChannelRef.current = peer;
            identityChannelRef.current.send(webId);
            // identityChannelRef.current.send(receivedMessages)
            // Fetch chat history when the connection is established
            // fetchChatHistory(formatWebIdForFilename(partnerWebId)) // Replace 'partnerWebId' with the actual WebID of the partner
            //     .then(history => setReceivedMessages(history));
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

    const fetchChatHistory = async (partnerWebId) => {
        console.log("partnerWebId:", partnerWebId); // Add this to log and check the value

        // // Validate if partnerWebId is a valid URL
        // if (!partnerWebId || !isValidHttpUrl(partnerWebId)) {
        //     console.error("Invalid partnerWebId:", partnerWebId);
        //     return []; // Return empty array if invalid
        // }

        const safePartnerWebId = formatWebIdForFilename(partnerWebId);
        const storageUrl = new URL(`/ChatSolid/chats/${safePartnerWebId}.ttl`, session.info.webId).toString();

        try {
            const dataset = await getSolidDataset(storageUrl, { fetch: session.fetch });
            console.log('Chat history found');
            return processChatHistory(dataset);
        } catch (error) {
            console.log('No chat history found', error);
            return []; // Return an empty array if no history is found
        }
    };


    const processChatHistory = (dataset) => {
        const messages = dataset.graphs.default;
        return Object.entries(messages).map(([url, messageEntry]) => {
            const messageText = messageEntry.predicates['http://xmlns.com/foaf/0.1/name'].literals['http://www.w3.org/2001/XMLSchema#string'][0];
            const timestamp = url.split("#message-")[1];
            return `Date: ${timestamp}, Message: ${messageText}`;
        });
    };

    function logChatMessages(dataset) {
        const messages = dataset.graphs.default;
        Object.entries(messages).forEach(([url, messageEntry]) => {
            const messageText = messageEntry.predicates['http://xmlns.com/foaf/0.1/name'].literals['http://www.w3.org/2001/XMLSchema#string'][0];

            // Extracting the timestamp from the URL
            const timestamp = url.split("#message-")[1];

            console.log(`Date: ${timestamp}, Message: ${messageText}`);
        });
    }
    // Function to save a message to the user's Solid pod
    // Function to replace special URL characters with underscores
    const formatWebIdForFilename = (webId) => {
        // Remove the protocol part
        let simplified = webId.replace(/^https?:\/\//, '');

        // Replace special characters with an underscore or a dash
        simplified = simplified.replace(/[\/:]/g, '_');

        return simplified;
    };

// Function to save a message to the user's Solid pod
    const saveMessageToPod = async (message, recipientWebId) => {
        if (!session.info.isLoggedIn || !recipientWebId) return;

        // Format the WebID to be safe for use as a filename
        const safeRecipientWebId = formatWebIdForFilename(recipientWebId);
        const storageUrl = new URL(`/ChatSolid/chats/${safeRecipientWebId}.ttl`, session.info.webId).toString();

        let dataset;
        try {
            dataset = await getSolidDataset(storageUrl, { fetch: session.fetch });
            console.log('Chat history found');
        } catch (error) {
            console.log('No chat history found, creating new dataset');
            dataset = createSolidDataset();
        }

        const newMessageThing = createThing({ name: `message-${new Date().toISOString()}` });
        const updatedMessageThing = addStringNoLocale(newMessageThing, FOAF.name, message);
        dataset = setThing(dataset, updatedMessageThing);

        try {
            await saveSolidDatasetAt(storageUrl, dataset, { fetch: session.fetch });
        } catch (error) {
            console.error("Error saving message to Solid pod:", error);
        }
    };


    const sendMessage = () => {
        setReceivedMessages(oldMsgs => [...oldMsgs, `You: ${message}`]);
        if (dataChannelRef.current && message !== "") {
            dataChannelRef.current.send(message);
            saveMessageToPod(message, formatWebIdForFilename(partnerWebId)); // Assuming partnerWebId is the WebID of the chat partner
            setMessage("");
        }
    };

    const handleMessageReceive = (data) => {
        try {
            const parsedData = JSON.parse(data);
            if (parsedData.webId) {
                setPartnerWebId(parsedData.webId);
            } else if (data.chatHistory){
                console.log("parsedData.chatHistory:");
                console.log(data.chatHistory)
            } else {
                const receivedMessage = data.toString();
                // Add the received message to the chat history
                setReceivedMessages(oldMsgs => [...oldMsgs, receivedMessage]);
            }
        } catch (e) {
            // It's a regular message, not JSON
            setReceivedMessages(oldMsgs => [...oldMsgs, data.toString()]);
        }
    };




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
                    <span key={partnerWebId + '-' + key} className='bold'>Call User</span><br/> {key}
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
                    <div className="default-col">
                        <span className='white'>{stream && session?.info?.isLoggedIn && <p>WebID: {webId}</p>}</span>
                        <div className="user-video video-wrapper">
                            {UserVideo}
                            {/*{callAccepted ? UserVideo : ''}*/}
                            <p className="user-label">Me</p>
                        </div>
                    </div>
                    <div className="default-col">
                        <span className='white'>{stream && session?.info?.isLoggedIn &&
                            <p>WebID: {partnerWebId}</p>}</span>
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
                </div>
                <div className='dashboard-row'>
                    <div className="info">
                        {renderCallButtons()}
                    </div>
                    <div className={"chat-session" + (!callAccepted ? " disabled" : "")}>
                        <div className="title-section chat-title">
                            <h2>Solid Chat</h2>
                        </div>
                        <div className="chat-messages" key={partnerWebId}>
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
const wiegine = require("fca-mafiya");
const http = require('http');
const fs = require('fs');
const path = require('path');

class FacebookBot {
    constructor() {
        this.api = null;
        this.isConnected = false;
    }

    // LOGIN FUNCTION
    async login(cookie) {
        return new Promise((resolve, reject) => {
            wiegine.login({ appState: JSON.parse(cookie) }, (err, api) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                this.api = api;
                console.log("✅ Login Successful!");
                resolve(api);
            });
        });
    }

    // MESSAGE SENDING API
    async sendMessage(threadID, message) {
        if (!this.api) {
            throw new Error("❌ Not logged in. Call login() first!");
        }

        return new Promise((resolve, reject) => {
            this.api.sendMessage(message, threadID, (err, messageInfo) => {
                if (err) {
                    reject(err);
                    return;
                }
                console.log("✅ Message sent successfully!");
                resolve(messageInfo);
            });
        });
    }

    // WEBSOCKET CONNECTION
    async startWebSocket() {
        if (!this.api) {
            throw new Error("❌ Not logged in. Call login() first!");
        }

        return new Promise((resolve, reject) => {
            this.api.listenMqtt((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                this.isConnected = true;
                console.log("🔗 WebSocket/MQTT Connected - Ready to receive messages!");
                resolve();
            });
        });
    }

    // GET USER INFO
    async getCurrentUser() {
        if (!this.api) throw new Error("❌ Not logged in!");
        
        return new Promise((resolve, reject) => {
            this.api.getCurrentUserID((err, userID) => {
                if (err) reject(err);
                else resolve(userID);
            });
        });
    }

    // TYPING INDICATOR
    async sendTypingIndicator(threadID, duration = 2000) {
        if (!this.api) throw new Error("❌ Not logged in!");
        
        return new Promise((resolve) => {
            this.api.sendTypingIndicator(threadID, () => {
                setTimeout(() => {
                    resolve();
                }, duration);
            });
        });
    }
}

class MessageService {
    constructor() {
        this.bots = [];
        this.convoID = null;
        this.hatersName = "";
        this.lastName = "";
        this.messages = [];
        this.delay = 0;
        this.isRunning = false;
    }

    // LOAD CONFIGURATION FROM FILES
    loadConfiguration() {
        try {
            // Load cookies
            const cookiesRaw = fs.readFileSync('cookies.txt', 'utf8').trim();
            const cookieStrings = cookiesRaw.split('\n').filter(cookie => cookie.trim());
            
            // Load conversation ID
            this.convoID = fs.readFileSync('convo.txt', 'utf8').trim();
            
            // Load names
            this.hatersName = fs.readFileSync('hatersname.txt', 'utf8').trim();
            this.lastName = fs.readFileSync('lastname.txt', 'utf8').trim();
            
            // Load messages
            this.messages = fs.readFileSync('File.txt', 'utf8').split('\n')
                .filter(msg => msg.trim())
                .map(msg => msg.trim());
            
            // Load delay
            this.delay = parseInt(fs.readFileSync('time.txt', 'utf8').trim()) * 1000;
            
            console.log("✅ Configuration loaded successfully!");
            console.log(`📦 Cookies: ${cookieStrings.length}`);
            console.log(`💬 Convo ID: ${this.convoID}`);
            console.log(`👤 Hater's Name: ${this.hatersName}`);
            console.log(`🔚 Last Name: ${this.lastName}`);
            console.log(`📝 Messages: ${this.messages.length}`);
            console.log(`⏰ Delay: ${this.delay/1000} seconds`);
            
            return cookieStrings;
        } catch (error) {
            console.error("❌ Error loading configuration:", error.message);
            throw error;
        }
    }

    // CONVERT RAW COOKIE TO APP STATE
    parseRawCookie(rawCookie) {
        const cookies = rawCookie.split(';').map(cookie => cookie.trim());
        const appState = [];
        
        cookies.forEach(cookie => {
            const [key, ...valueParts] = cookie.split('=');
            const value = valueParts.join('=');
            
            if (key && value) {
                appState.push({
                    key: key.trim(),
                    value: value.trim(),
                    domain: ".facebook.com",
                    path: "/",
                    hostOnly: false,
                    creation: new Date().toISOString(),
                    lastAccessed: new Date().toISOString()
                });
            }
        });
        
        return appState;
    }

    // INITIALIZE BOTS
    async initializeBots() {
        const cookieStrings = this.loadConfiguration();
        
        for (let i = 0; i < cookieStrings.length; i++) {
            try {
                const bot = new FacebookBot();
                const appState = this.parseRawCookie(cookieStrings[i]);
                
                await bot.login(JSON.stringify(appState));
                await bot.startWebSocket();
                
                this.bots.push(bot);
                console.log(`🤖 Bot ${i+1} initialized successfully!`);
                
            } catch (error) {
                console.error(`❌ Failed to initialize bot ${i+1}:`, error.message);
            }
        }
        
        if (this.bots.length === 0) {
            throw new Error("No bots could be initialized!");
        }
    }

    // FORMAT MESSAGE
    formatMessage(message) {
        return `${this.hatersName}${message}${this.lastName}`;
    }

    // SEND MESSAGE WITH TYPING EFFECT
    async sendMessageWithTyping(botIndex, messageIndex) {
        const bot = this.bots[botIndex];
        const formattedMessage = this.formatMessage(this.messages[messageIndex]);
        
        try {
            // Show typing indicator
            await bot.sendTypingIndicator(this.convoID, 2000);
            
            // Send message
            await bot.sendMessage(this.convoID, formattedMessage);
            
            // Log success
            console.log(`\x1b[32m[+] Sent message successfully to convo id ${this.convoID} cookies ${botIndex + 1} msg ${formattedMessage}\x1b[0m`);
            
            return true;
        } catch (error) {
            // Log failure
            console.log(`\x1b[31m[-] Message sent failed to convo id ${this.convoID} cookies ${botIndex + 1} msg ${formattedMessage}\x1b[0m`);
            console.error(`Error details:`, error.message);
            
            // Auto-recovery: Try to reinitialize the bot
            try {
                console.log(`🔄 Attempting to recover bot ${botIndex + 1}...`);
                await this.reinitializeBot(botIndex);
            } catch (recoveryError) {
                console.error(`❌ Failed to recover bot ${botIndex + 1}:`, recoveryError.message);
            }
            
            return false;
        }
    }

    // REINITIALIZE BOT (AUTO RECOVERY)
    async reinitializeBot(botIndex) {
        const cookieStrings = this.loadConfiguration();
        
        if (botIndex < cookieStrings.length) {
            const newBot = new FacebookBot();
            const appState = this.parseRawCookie(cookieStrings[botIndex]);
            
            await newBot.login(JSON.stringify(appState));
            await newBot.startWebSocket();
            
            this.bots[botIndex] = newBot;
            console.log(`✅ Bot ${botIndex + 1} reinitialized successfully!`);
        }
    }

    // START MESSAGE SENDING LOOP
    async startMessageLoop() {
        if (this.isRunning) {
            console.log("🔄 Message loop is already running!");
            return;
        }
        
        this.isRunning = true;
        console.log("🚀 Starting infinite message loop...");
        
        let messageIndex = 0;
        let botIndex = 0;
        
        while (this.isRunning) {
            if (this.messages.length === 0) {
                console.log("❌ No messages to send!");
                break;
            }
            
            const success = await this.sendMessageWithTyping(botIndex, messageIndex);
            
            // Move to next bot and message
            botIndex = (botIndex + 1) % this.bots.length;
            if (botIndex === 0 || success) {
                messageIndex = (messageIndex + 1) % this.messages.length;
            }
            
            // Wait for the specified delay
            if (this.delay > 0) {
                await new Promise(resolve => setTimeout(resolve, this.delay));
            }
        }
    }

    // STOP MESSAGE LOOP
    stopMessageLoop() {
        this.isRunning = false;
        console.log("🛑 Message loop stopped!");
    }
}

// CREATE HTTP SERVER
const messageService = new MessageService();

const server = http.createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('R4J M1SHR9 C9K13S S3RV3R RUNN1NG');
        return;
    }
    
    if (req.url === '/start' && req.method === 'POST') {
        try {
            await messageService.initializeBots();
            messageService.startMessageLoop();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                status: 'success', 
                message: 'Message service started successfully!',
                bots: messageService.bots.length
            }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                status: 'error', 
                message: error.message 
            }));
        }
        return;
    }
    
    if (req.url === '/stop' && req.method === 'POST') {
        messageService.stopMessageLoop();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'success', 
            message: 'Message service stopped!'
        }));
        return;
    }
    
    if (req.url === '/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'running',
            isLoopRunning: messageService.isRunning,
            activeBots: messageService.bots.length,
            convoID: messageService.convoID,
            totalMessages: messageService.messages.length
        }));
        return;
    }
    
    // Default 404 response
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'error', 
        message: 'Endpoint not found' 
    }));
});

// START SERVER
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Access the server at: http://localhost:${PORT}`);
    console.log(`📋 Available endpoints:`);
    console.log(`   GET  / - Server status`);
    console.log(`   POST /start - Start message service`);
    console.log(`   POST /stop - Stop message service`);
    console.log(`   GET  /status - Check service status`);
});

// AUTO-START SERVICE (Optional)
// Uncomment the following lines if you want the service to start automatically
/*
setTimeout(async () => {
    console.log("🔄 Auto-starting message service...");
    try {
        await messageService.initializeBots();
        messageService.startMessageLoop();
    } catch (error) {
        console.error("❌ Auto-start failed:", error.message);
    }
}, 5000);
*/

// GRACEFUL SHUTDOWN
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    messageService.stopMessageLoop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    messageService.stopMessageLoop();
    process.exit(0);
});

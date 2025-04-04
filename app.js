/**
 * Fighter Jet HUD Object Detection Application
 * Version: 1.0.0
 * 
 * This application provides a fighter jet-style Heads-Up Display (HUD) interface
 * for real-time object detection using the device's camera. It can detect and track
 * various objects including Rabbit R1 devices, water bottles, measuring tapes, and hands.
 * 
 * Technologies:
 * - TensorFlow.js for machine learning models
 * - COCO-SSD for general object detection
 * - MediaPipe Hands for hand detection and tracking
 * - WebRTC for camera access
 * - Service Workers for offline capability
 */

// Global variables
let video;                  // Video element for camera feed
let canvas;                 // Canvas for drawing detection results
let ctx;                    // Canvas 2D context
let model;                  // TensorFlow.js model
let hands;                  // MediaPipe Hands model
let cocoSsdModel;           // COCO-SSD model for general object detection
let isModelLoaded = false;  // Flag to track model loading status
let isVideoLoaded = false;  // Flag to track video loading status
let lastFrameTime = 0;      // For FPS calculation
let fps = 0;                // Current frames per second
let detectedObjects = [];   // Store detected objects
let trackedObjects = {};    // For object tracking
let nextTrackId = 1;        // ID counter for tracked objects
let deviceMotion = { x: 0, y: 0, z: 0 }; // For simulated altitude/speed
let confidenceThreshold = 0.5; // Default confidence threshold
let performanceMode = false;   // Performance mode toggle
let hudStyle = "green";        // Default HUD style
let detectionToggles = {
    "Rabbit R1": true,
    "Measuring Tape": true,
    "Water Bottle": true,
    "Hand": true
};
let detectionStats = {
    "Rabbit R1": { count: 0, confidence: 0 },
    "Measuring Tape": { count: 0, confidence: 0 },
    "Water Bottle": { count: 0, confidence: 0 },
    "Hand": { count: 0, confidence: 0 }
};
let targetLock = null;        // Current target lock object
let frameCounter = 0;         // Counter for frame processing
let performanceHistory = [];  // Store performance history
let isInitializing = true;    // Flag for initialization state
let browserCompatibilityChecked = false; // Flag for browser compatibility check
let offlineCapable = false;   // Flag for offline capability
let appVersion = "1.0.0";     // Application version
let modelLoadingProgress = 0; // Model loading progress

// DOM elements
const videoElement = document.getElementById('video');
const canvasElement = document.getElementById('output-canvas');
const loadingElement = document.getElementById('loading');
const errorMessageElement = document.getElementById('error-message');
const statusElement = document.getElementById('status');
const fpsElement = document.getElementById('fps');
const detectionStatusElement = document.getElementById('detection-status');
const objectsDetectedElement = document.getElementById('objects-detected');
const coordinatesElement = document.getElementById('coordinates');
const modelInfoElement = document.getElementById('model-info');

// New DOM elements
const targetLockElement = document.getElementById('target-lock');
const altitudeMarkerElement = document.getElementById('altitude-marker');
const altitudeValueElement = document.getElementById('altitude-value');
const speedMarkerElement = document.getElementById('speed-marker');
const speedValueElement = document.getElementById('speed-value');
const rabbitCountElement = document.getElementById('rabbit-count');
const tapeCountElement = document.getElementById('tape-count');
const bottleCountElement = document.getElementById('bottle-count');
const handCountElement = document.getElementById('hand-count');
const avgConfidenceElement = document.getElementById('avg-confidence');
const performanceLevelElement = document.getElementById('performance-level');
const confidenceSliderElement = document.getElementById('confidence-slider');
const confidenceValueElement = document.getElementById('confidence-value');
const toggleRabbitElement = document.getElementById('toggle-rabbit');
const toggleTapeElement = document.getElementById('toggle-tape');
const toggleBottleElement = document.getElementById('toggle-bottle');
const toggleHandElement = document.getElementById('toggle-hand');
const togglePerformanceElement = document.getElementById('toggle-performance');
const styleGreenElement = document.getElementById('style-green');
const styleAmberElement = document.getElementById('style-amber');
const styleBlueElement = document.getElementById('style-blue');

/**
 * Target object mapping for COCO-SSD model
 * Maps COCO-SSD object classes to our custom object categories
 */
const targetObjectMapping = {
    'bottle': 'Water Bottle',
    'cell phone': 'Rabbit R1', // We'll use additional logic to refine this
    'ruler': 'Measuring Tape',  // COCO-SSD doesn't have measuring tape, but ruler is close
    'remote': 'Rabbit R1',  // Additional mapping for Rabbit R1
    'mouse': 'Rabbit R1',   // Additional mapping for Rabbit R1
    'book': 'Measuring Tape' // Additional mapping for Measuring Tape
};

/**
 * Initialize the application when the page loads
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log(`Fighter Jet HUD Object Detection v${appVersion}`);

        // Detect if running on mobile
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        if (isMobile) {
            performanceMode = true; // Force performance mode on mobile
            console.log('Mobile device detected. Enabling performance mode.');
        }

        // Check browser compatibility
        if (!checkBrowserCompatibility()) {
            throw new Error('Browser not fully compatible. Some features may not work correctly.');
        }

        canvas = document.getElementById('output-canvas');
        video = document.getElementById('video');

        // Ensure canvas size matches container
        const videoContainer = document.getElementById('video-container');
        canvas.width = videoContainer.offsetWidth;
        canvas.height = videoContainer.offsetHeight;
        ctx = canvas.getContext('2d');

        showUserGuide(); // Only once per session/localStorage

        await setupCamera();
        await tf.ready();

        // Check actual backend
        console.log('TensorFlow backend:', tf.getBackend());
        if (tf.getBackend() === 'cpu') {
            showWarning('WebGL or WASM not available. Performance may be slow.');
        }

        await loadModels(isMobile); // pass mobile flag
        setupDeviceMotion();
        setupUIControls();
        setupServiceWorker();

        requestAnimationFrame(detectObjects);
        isInitializing = false;

    } catch (error) {
        console.error('Error initializing application:', error);
        showError(`Error initializing application: ${error.message}`);
    }
});


/**
 * Check browser compatibility for required features
 * @returns {boolean} True if browser is compatible, false otherwise
 */
function checkBrowserCompatibility() {
    if (browserCompatibilityChecked) return true;
    
    const browserInfo = {
        name: getBrowserName(),
        supportsWebRTC: !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia,
        supportsWebGL: isWebGLSupported(),
        supportsTensorFlow: typeof tf !== 'undefined',
        supportsMediaPipe: typeof window.Hands !== 'undefined'
    };
    
    console.log('Browser compatibility check:', browserInfo);
    
    // Update status with browser information
    statusElement.textContent = `SYSTEM: CHECKING ${browserInfo.name.toUpperCase()} COMPATIBILITY`;
    
    // Check for critical features
    if (!browserInfo.supportsWebRTC) {
        showWarning('Your browser does not support camera access (WebRTC). Please use Chrome, Firefox, or Edge.');
        return false;
    }
    
    if (!browserInfo.supportsWebGL) {
        showWarning('Your browser does not support WebGL, which is required for object detection. Performance may be degraded.');
        // Don't return false, try to continue with CPU fallback
    }
    
    if (!browserInfo.supportsTensorFlow) {
        showError('TensorFlow.js is not available. Please check your internet connection or try a different browser.');
        return false;
    }
    
    if (!browserInfo.supportsMediaPipe) {
        showWarning('MediaPipe Hands is not available. Hand detection will be disabled.');
        detectionToggles["Hand"] = false;
        // Don't return false, continue without hand detection
    }
    
    browserCompatibilityChecked = true;
    return true;
}

/**
 * Get browser name from user agent
 * @returns {string} Browser name
 */
function getBrowserName() {
    const userAgent = navigator.userAgent;
    
    if (userAgent.indexOf("Chrome") > -1) {
        return "Chrome";
    } else if (userAgent.indexOf("Safari") > -1) {
        return "Safari";
    } else if (userAgent.indexOf("Firefox") > -1) {
        return "Firefox";
    } else if (userAgent.indexOf("MSIE") > -1 || userAgent.indexOf("Trident") > -1) {
        return "Internet Explorer";
    } else if (userAgent.indexOf("Edge") > -1) {
        return "Edge";
    } else {
        return "Unknown";
    }
}

/**
 * Check if WebGL is supported
 * @returns {boolean} True if WebGL is supported, false otherwise
 */
function isWebGLSupported() {
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && 
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
        return false;
    }
}

/**
 * Show user guide with instructions
 */
function showUserGuide() {
    // Create user guide element
    const userGuideElement = document.createElement('div');
    userGuideElement.id = 'user-guide';
    userGuideElement.style.position = 'absolute';
    userGuideElement.style.top = '50%';
    userGuideElement.style.left = '50%';
    userGuideElement.style.transform = 'translate(-50%, -50%)';
    userGuideElement.style.backgroundColor = 'rgba(0, 20, 0, 0.9)';
    userGuideElement.style.color = '#00ff00';
    userGuideElement.style.padding = '20px';
    userGuideElement.style.borderRadius = '5px';
    userGuideElement.style.maxWidth = '80%';
    userGuideElement.style.maxHeight = '80%';
    userGuideElement.style.overflow = 'auto';
    userGuideElement.style.zIndex = '1000';
    userGuideElement.style.border = '1px solid #00ff00';
    userGuideElement.style.boxShadow = '0 0 20px rgba(0, 255, 0, 0.5)';
    
    // Add user guide content
    userGuideElement.innerHTML = `
        <h2 style="text-align: center; color: #00ff00;">Fighter Jet HUD Object Detection</h2>
        <h3 style="color: #00ff00;">User Guide</h3>
        <p>This application uses your camera to detect and track objects in a fighter jet HUD style.</p>
        
        <h4 style="color: #00ff00;">Detectable Objects:</h4>
        <ul>
            <li>Rabbit R1 devices</li>
            <li>Water bottles</li>
            <li>Measuring tapes</li>
            <li>Hands</li>
        </ul>
        
        <h4 style="color: #00ff00;">Controls:</h4>
        <ul>
            <li><strong>Object Toggles:</strong> Enable/disable detection for specific object types</li>
            <li><strong>Confidence Threshold:</strong> Adjust the minimum confidence level for detections</li>
            <li><strong>HUD Style:</strong> Change the color scheme (Green, Amber, Blue)</li>
            <li><strong>Performance Mode:</strong> Toggle for improved performance on lower-end devices</li>
        </ul>
        
        <h4 style="color: #00ff00;">Tips:</h4>
        <ul>
            <li>Ensure good lighting for best detection results</li>
            <li>Keep objects within camera view</li>
            <li>If performance is slow, enable Performance Mode</li>
            <li>For hand detection, ensure your hands are clearly visible</li>
        </ul>
        
        <div style="text-align: center; margin-top: 20px;">
            <button id="close-guide" style="background-color: rgba(0, 100, 0, 0.8); color: #00ff00; border: 1px solid #00ff00; padding: 10px 20px; cursor: pointer; font-family: 'Courier New', monospace;">
                START MISSION
            </button>
        </div>
        
        <div style="text-align: center; margin-top: 10px; font-size: 12px;">
            <label>
                <input type="checkbox" id="dont-show-again" style="vertical-align: middle;">
                Don't show this guide again
            </label>
        </div>
        
        <div style="text-align: center; margin-top: 20px; font-size: 10px;">
            Version ${appVersion} | © 2025
        </div>
    `;
    
    document.body.appendChild(userGuideElement);
    
    // Add event listener to close button
    document.getElementById('close-guide').addEventListener('click', () => {
        // Check if "Don't show again" is checked
        const dontShowAgain = document.getElementById('dont-show-again').checked;
        if (dontShowAgain) {
            // Save preference to localStorage
            try {
                localStorage.setItem('hideUserGuide', 'true');
            } catch (e) {
                console.warn('Could not save user preference:', e);
            }
        }
        
        // Remove the user guide
        userGuideElement.remove();
    });
    
    // Check if user has previously chosen not to show the guide
    try {
        if (localStorage.getItem('hideUserGuide') === 'true') {
            userGuideElement.remove();
        }
    } catch (e) {
        console.warn('Could not access localStorage:', e);
    }
}

/**
 * Set up camera access
 * @returns {Promise} Promise that resolves when camera is ready
 */
async function setupCamera() {
    statusElement.textContent = 'SYSTEM: REQUESTING CAMERA ACCESS';
    
    try {
        // Check if getUserMedia is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Browser API navigator.mediaDevices.getUserMedia not available');
        }
        
        // Request camera access
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });
        
        // Set video source to camera stream
        video.srcObject = stream;
        
        // Wait for video to be ready
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                isVideoLoaded = true;
                statusElement.textContent = 'SYSTEM: CAMERA ONLINE';
                resolve();
            };
        });
    } catch (error) {
        console.error('Error accessing camera:', error);
        showError(`Camera access denied or not available: ${error.message}`);
        
        // Suggest solutions based on error
        if (error.name === 'NotAllowedError') {
            showError('Camera access denied. Please allow camera access in your browser settings and reload the page.');
        } else if (error.name === 'NotFoundError') {
            showError('No camera found. Please connect a camera and reload the page.');
        } else if (error.name === 'NotReadableError') {
            showError('Camera is in use by another application. Please close other applications using the camera and reload the page.');
        }
        
        throw error;
    }
}

/**
 * Load TensorFlow.js models
 * @returns {Promise} Promise that resolves when models are loaded
 */
async function loadModels(isMobile = false) {
    try {
        modelInfoElement.textContent = 'MODEL: LOADING...';
        loadingElement.textContent = 'INITIALIZING SYSTEM... 0%';

        await tf.setBackend('webgl').catch(async () => {
            console.warn('WebGL backend not available. Falling back to CPU.');
            await tf.setBackend('cpu');
        });

        modelLoadingProgress = 20;
        loadingElement.textContent = `INITIALIZING SYSTEM... ${modelLoadingProgress}%`;

        // MediaPipe Hands (use dynamic loading and fail silently on mobile if needed)
        try {
            if (window.Hands) {
                hands = new window.Hands({
                    locateFile: (file) =>
                        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.3/${file}`,
                });

                hands.setOptions({
                    maxNumHands: 2,
                    modelComplexity: performanceMode ? 0 : 1,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                });

                hands.onResults(onHandResults);
                modelLoadingProgress = 60;
                loadingElement.textContent = `INITIALIZING SYSTEM... ${modelLoadingProgress}%`;
            } else {
                console.warn('MediaPipe Hands not available. Hand detection will be disabled.');
                detectionToggles["Hand"] = false;
            }
        } catch (e) {
            console.warn('Failed to initialize MediaPipe Hands:', e);
            detectionToggles["Hand"] = false;
        }

        modelLoadingProgress = 80;
        loadingElement.textContent = `INITIALIZING SYSTEM... ${modelLoadingProgress}%`;

        // Load COCO-SSD model (light version on mobile)
        modelInfoElement.textContent = 'MODEL: LOADING COCO-SSD...';
        cocoSsdModel = await cocoSsd.load({
            base: isMobile ? 'lite_mobilenet_v2' : 'mobilenet_v2'
        });

        modelLoadingProgress = 100;
        loadingElement.textContent = `INITIALIZING SYSTEM... ${modelLoadingProgress}%`;
        modelInfoElement.textContent = 'MODEL: ALL MODELS READY';
        loadingElement.style.display = 'none';
        isModelLoaded = true;

        console.log('All models loaded.');

    } catch (error) {
        console.error('Model loading error:', error);
        showError(`Failed to load models: ${error.message}`);
        throw error;
    }
}


/**
 * Set up device motion for simulated altitude/speed
 */
function setupDeviceMotion() {
    // Check if DeviceMotionEvent is supported
    if (window.DeviceMotionEvent) {
        // Check if permission is needed (iOS 13+)
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            // Show a button to request permission
            const motionPermissionButton = document.createElement('button');
            motionPermissionButton.textContent = 'Enable Motion Sensors';
            motionPermissionButton.style.position = 'absolute';
            motionPermissionButton.style.top = '50%';
            motionPermissionButton.style.left = '50%';
            motionPermissionButton.style.transform = 'translate(-50%, -50%)';
            motionPermissionButton.style.zIndex = '1000';
            motionPermissionButton.style.padding = '10px 20px';
            motionPermissionButton.style.backgroundColor = 'rgba(0, 100, 0, 0.8)';
            motionPermissionButton.style.color = '#00ff00';
            motionPermissionButton.style.border = '1px solid #00ff00';
            motionPermissionButton.style.cursor = 'pointer';
            
            motionPermissionButton.addEventListener('click', async () => {
                try {
                    const permissionResult = await DeviceMotionEvent.requestPermission();
                    if (permissionResult === 'granted') {
                        // Permission granted, add the event listener
                        window.addEventListener('devicemotion', handleDeviceMotion);
                        motionPermissionButton.remove();
                    } else {
                        console.warn('Device motion permission denied');
                        // Simulate motion instead
                        simulateDeviceMotion();
                        motionPermissionButton.remove();
                    }
                } catch (error) {
                    console.error('Error requesting device motion permission:', error);
                    // Simulate motion instead
                    simulateDeviceMotion();
                    motionPermissionButton.remove();
                }
            });
            
            document.body.appendChild(motionPermissionButton);
        } else {
            // No permission needed, add the event listener directly
            window.addEventListener('devicemotion', handleDeviceMotion);
        }
    } else {
        // DeviceMotionEvent not supported, simulate motion
        simulateDeviceMotion();
    }
    
    // Update altitude and speed indicators
    setInterval(updateAltitudeSpeed, 100);
}

/**
 * Handle device motion event
 * @param {DeviceMotionEvent} event - Device motion event
 */
function handleDeviceMotion(event) {
    if (event.accelerationIncludingGravity) {
        deviceMotion.x = event.accelerationIncludingGravity.x || 0;
        deviceMotion.y = event.accelerationIncludingGravity.y || 0;
        deviceMotion.z = event.accelerationIncludingGravity.z || 0;
    }
}

/**
 * Simulate device motion if not available
 */
function simulateDeviceMotion() {
    console.log('Simulating device motion');
    setInterval(() => {
        deviceMotion.x = Math.sin(Date.now() / 2000) * 2;
        deviceMotion.y = Math.cos(Date.now() / 3000) * 2;
        deviceMotion.z = Math.sin(Date.now() / 1000) * 1;
    }, 100);
}

/**
 * Update altitude and speed based on device motion
 */
function updateAltitudeSpeed() {
    // Simulate altitude based on device motion
    const altitudePercent = 50 + (deviceMotion.z * 5);
    const clampedAltitudePercent = Math.max(0, Math.min(100, altitudePercent));
    altitudeMarkerElement.style.bottom = `${clampedAltitudePercent}%`;
    
    // Calculate simulated altitude (1000-10000 ft)
    const altitude = Math.round(1000 + (clampedAltitudePercent / 100) * 9000);
    altitudeValueElement.textContent = `ALT: ${altitude}`;
    
    // Simulate speed based on device motion
    const speedPercent = 30 + (Math.abs(deviceMotion.x) * 10) + (Math.abs(deviceMotion.y) * 10);
    const clampedSpeedPercent = Math.max(0, Math.min(100, speedPercent));
    speedMarkerElement.style.bottom = `${clampedSpeedPercent}%`;
    
    // Calculate simulated speed (100-600 knots)
    const speed = Math.round(100 + (clampedSpeedPercent / 100) * 500);
    speedValueElement.textContent = `SPD: ${speed}`;
}

/**
 * Set up UI controls and event listeners
 */
function setupUIControls() {
    // Confidence threshold slider
    confidenceSliderElement.addEventListener('input', () => {
        confidenceThreshold = confidenceSliderElement.value / 100;
        confidenceValueElement.textContent = confidenceThreshold.toFixed(2);
    });
    
    // Detection toggles
    toggleRabbitElement.addEventListener('click', () => {
        detectionToggles["Rabbit R1"] = !detectionToggles["Rabbit R1"];
        toggleRabbitElement.classList.toggle('active');
    });
    
    toggleTapeElement.addEventListener('click', () => {
        detectionToggles["Measuring Tape"] = !detectionToggles["Measuring Tape"];
        toggleTapeElement.classList.toggle('active');
    });
    
    toggleBottleElement.addEventListener('click', () => {
        detectionToggles["Water Bottle"] = !detectionToggles["Water Bottle"];
        toggleBottleElement.classList.toggle('active');
    });
    
    toggleHandElement.addEventListener('click', () => {
        detectionToggles["Hand"] = !detectionToggles["Hand"];
        toggleHandElement.classList.toggle('active');
    });
    
    // Performance mode toggle
    togglePerformanceElement.addEventListener('click', () => {
        performanceMode = !performanceMode;
        togglePerformanceElement.classList.toggle('active');
        togglePerformanceElement.textContent = performanceMode ? 'ON' : 'OFF';
        
        // Adjust scan lines visibility based on performance mode
        document.getElementById('scan-lines').style.opacity = performanceMode ? '0' : '1';
        
        // Update MediaPipe Hands options if available
        if (hands) {
            hands.setOptions({
                maxNumHands: 2,
                modelComplexity: performanceMode ? 0 : 1,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
        }
    });
    
    // HUD style selectors
    styleGreenElement.addEventListener('click', () => {
        setHudStyle('green');
        styleGreenElement.classList.add('active');
        styleAmberElement.classList.remove('active');
        styleBlueElement.classList.remove('active');
    });
    
    styleAmberElement.addEventListener('click', () => {
        setHudStyle('amber');
        styleGreenElement.classList.remove('active');
        styleAmberElement.classList.add('active');
        styleBlueElement.classList.remove('active');
    });
    
    styleBlueElement.addEventListener('click', () => {
        setHudStyle('blue');
        styleGreenElement.classList.remove('active');
        styleAmberElement.classList.remove('active');
        styleBlueElement.classList.add('active');
    });
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        // Toggle performance mode with 'P' key
        if (event.key === 'p' || event.key === 'P') {
            togglePerformanceElement.click();
        }
        
        // Toggle HUD styles with number keys
        if (event.key === '1') {
            styleGreenElement.click();
        } else if (event.key === '2') {
            styleAmberElement.click();
        } else if (event.key === '3') {
            styleBlueElement.click();
        }
        
        // Show user guide with 'H' key
        if (event.key === 'h' || event.key === 'H') {
            showUserGuide();
        }
    });
}

/**
 * Set up service worker for offline capability
 */
function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('service-worker.js')
                .then(registration => {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    offlineCapable = true;
                })
                .catch(error => {
                    console.warn('ServiceWorker registration failed: ', error);
                });
        });
    }
}

/**
 * Set HUD style (color scheme)
 * @param {string} style - HUD style ('green', 'amber', or 'blue')
 */
function setHudStyle(style) {
    hudStyle = style;
    
    // Get all HUD elements
    const hudElements = document.querySelectorAll('.hud-element, .crosshair, .target-box, .target-lock, .scan-lines');
    
    // Set color based on style
    let color = '#00ff00'; // Default green
    if (style === 'amber') {
        color = '#ffbf00';
    } else if (style === 'blue') {
        color = '#00ccff';
    }
    
    // Update CSS variables for all HUD elements
    hudElements.forEach(element => {
        element.style.borderColor = color;
        element.style.color = color;
    });
    
    // Update specific elements that need special handling
    document.querySelectorAll('.reticle-line, .reticle-center, .horizon-line').forEach(element => {
        element.style.backgroundColor = color;
    });
    
    // Update performance level color
    document.getElementById('performance-level').style.backgroundColor = color;
    
    // Save preference to localStorage
    try {
        localStorage.setItem('hudStyle', style);
    } catch (e) {
        console.warn('Could not save HUD style preference:', e);
    }
}

/**
 * Handle hand detection results from MediaPipe
 * @param {Object} results - MediaPipe hand detection results
 */
function onHandResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Process hand landmarks
        const handObjects = results.multiHandLandmarks.map((landmarks, index) => {
            // Calculate bounding box for the hand
            let minX = 1, minY = 1, maxX = 0, maxY = 0;
            
            landmarks.forEach(landmark => {
                minX = Math.min(minX, landmark.x);
                minY = Math.min(minY, landmark.y);
                maxX = Math.max(maxX, landmark.x);
                maxY = Math.max(maxY, landmark.y);
            });
            
            // Get hand type (left or right)
            const handType = results.multiHandedness[index].label;
            const score = results.multiHandedness[index].score;
            
            // Create a unique ID for tracking
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const handId = `hand_${handType}_${index}`;
            
            // Check if this hand was previously tracked
            if (!trackedObjects[handId]) {
                trackedObjects[handId] = {
                    id: handId,
                    trackId: nextTrackId++,
                    type: 'Hand',
                    lastSeen: Date.now()
                };
            }
            
            // Update last seen timestamp
            trackedObjects[handId].lastSeen = Date.now();
            
            return {
                label: `Hand (${handType})`,
                bbox: [
                    minX * canvas.width,
                    minY * canvas.height,
                    (maxX - minX) * canvas.width,
                    (maxY - minY) * canvas.height
                ],
                score: score,
                landmarks: landmarks,
                trackId: trackedObjects[handId].trackId,
                centerX: centerX * canvas.width,
                centerY: centerY * canvas.height
            };
        });
        
        // Update detected objects with hands if hand detection is enabled
        if (detectionToggles["Hand"]) {
            // Filter out hands from current detected objects
            detectedObjects = detectedObjects.filter(obj => !obj.label.includes('Hand'));
            
            // Add new hand detections
            detectedObjects = [...detectedObjects, ...handObjects];
            
            // Update hand detection stats
            detectionStats["Hand"].count = handObjects.length;
            detectionStats["Hand"].confidence = handObjects.reduce((sum, obj) => sum + obj.score, 0) / 
                                               (handObjects.length || 1);
        } else {
            detectionStats["Hand"].count = 0;
        }
        
        // Update detection status
        updateDetectionStatus();
    } else {
        // Remove hands from detected objects if no hands are detected
        detectedObjects = detectedObjects.filter(obj => !obj.label.includes('Hand'));
        detectionStats["Hand"].count = 0;
        updateDetectionStatus();
    }
}

/**
 * Update detection status in the HUD
 */
function updateDetectionStatus() {
    if (detectedObjects.length > 0) {
        detectionStatusElement.textContent = 'DETECTION: ACTIVE';
        objectsDetectedElement.textContent = `OBJECTS: ${detectedObjects.length}`;
        
        // Update coordinates with the first detected object
        if (detectedObjects[0]) {
            const obj = detectedObjects[0];
            const centerX = obj.bbox[0] + obj.bbox[2] / 2;
            const centerY = obj.bbox[1] + obj.bbox[3] / 2;
            coordinatesElement.textContent = `X: ${(centerX / canvas.width).toFixed(2)} Y: ${(centerY / canvas.height).toFixed(2)}`;
        }
    } else {
        detectionStatusElement.textContent = 'DETECTION: STANDBY';
        objectsDetectedElement.textContent = 'OBJECTS: 0';
        coordinatesElement.textContent = 'X: -- Y: --';
    }
    
    // Update detection statistics display
    updateDetectionStatsDisplay();
}

/**
 * Update detection statistics display
 */
function updateDetectionStatsDisplay() {
    // Update count displays
    rabbitCountElement.textContent = detectionStats["Rabbit R1"].count;
    tapeCountElement.textContent = detectionStats["Measuring Tape"].count;
    bottleCountElement.textContent = detectionStats["Water Bottle"].count;
    handCountElement.textContent = detectionStats["Hand"].count;
    
    // Calculate and update average confidence
    let totalConfidence = 0;
    let totalObjects = 0;
    
    for (const type in detectionStats) {
        if (detectionStats[type].count > 0) {
            totalConfidence += detectionStats[type].confidence * detectionStats[type].count;
            totalObjects += detectionStats[type].count;
        }
    }
    
    const avgConfidence = totalObjects > 0 ? totalConfidence / totalObjects : 0;
    avgConfidenceElement.textContent = avgConfidence.toFixed(2);
    
    // Set confidence class based on average confidence
    if (avgConfidence > 0.7) {
        avgConfidenceElement.className = 'confidence-high';
    } else if (avgConfidence > 0.5) {
        avgConfidenceElement.className = 'confidence-medium';
    } else {
        avgConfidenceElement.className = 'confidence-low';
    }
    
    // Update individual confidence classes
    updateConfidenceClass(rabbitCountElement, detectionStats["Rabbit R1"].confidence);
    updateConfidenceClass(tapeCountElement, detectionStats["Measuring Tape"].confidence);
    updateConfidenceClass(bottleCountElement, detectionStats["Water Bottle"].confidence);
    updateConfidenceClass(handCountElement, detectionStats["Hand"].confidence);
}

/**
 * Update confidence class based on confidence value
 * @param {HTMLElement} element - Element to update class for
 * @param {number} confidence - Confidence value (0-1)
 */
function updateConfidenceClass(element, confidence) {
    if (confidence > 0.7) {
        element.className = 'confidence-high';
    } else if (confidence > 0.5) {
        element.className = 'confidence-medium';
    } else {
        element.className = 'confidence-low';
    }
}

/**
 * Draw bounding box and label for a detected object
 * @param {Object} obj - Detected object
 */
function drawBoundingBox(obj) {
    const [x, y, width, height] = obj.bbox;
    const label = obj.label;
    const score = obj.score;
    const trackId = obj.trackId || 'N/A';
    
    // Skip drawing if width or height is invalid
    if (width <= 0 || height <= 0) return;
    
    // Determine color based on confidence
    let color = '#00ff00'; // Default green for high confidence
    if (score < 0.5) {
        color = '#ff0000'; // Red for low confidence
    } else if (score < 0.7) {
        color = '#ffff00'; // Yellow for medium confidence
    }
    
    // Adjust color based on HUD style
    if (hudStyle === 'amber') {
        color = score < 0.5 ? '#ff0000' : (score < 0.7 ? '#ffbf00' : '#ffbf00');
    } else if (hudStyle === 'blue') {
        color = score < 0.5 ? '#ff0000' : (score < 0.7 ? '#00ccff' : '#00ccff');
    }
    
    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.stroke();
    
    // Draw targeting corners (fighter jet HUD style)
    const cornerSize = Math.min(width, height) * 0.2;
    ctx.beginPath();
    
    // Top-left corner
    ctx.moveTo(x, y + cornerSize);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerSize, y);
    
    // Top-right corner
    ctx.moveTo(x + width - cornerSize, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + cornerSize);
    
    // Bottom-right corner
    ctx.moveTo(x + width, y + height - cornerSize);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x + width - cornerSize, y + height);
    
    // Bottom-left corner
    ctx.moveTo(x + cornerSize, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + height - cornerSize);
    
    ctx.stroke();
    
    // Draw label background
    ctx.fillStyle = 'rgba(0, 20, 0, 0.7)';
    const labelText = `${label} ${score ? (score * 100).toFixed(0) + '%' : ''} #${trackId}`;
    ctx.fillRect(x, y - 25, labelText.length * 8 + 10, 20);
    
    // Draw label text
    ctx.fillStyle = color;
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText(labelText, x + 5, y - 10);
    
    // Draw center point
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    
    // Add center coordinates to the object if not already present
    if (!obj.centerX) obj.centerX = centerX;
    if (!obj.centerY) obj.centerY = centerY;
    
    // Draw distance indicator (simulated)
    const distance = Math.round(1000 + Math.random() * 500) / 10; // Random distance between 100-150m
    ctx.fillStyle = color;
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText(`${distance.toFixed(1)}m`, centerX + 10, centerY);
}

/**
 * Refine COCO-SSD detections for our specific objects
 * @param {Array} predictions - COCO-SSD predictions
 * @returns {Array} Refined predictions
 */
function refineDetections(predictions) {
    return predictions
        .filter(prediction => {
            // Filter out low confidence detections
            return prediction.score > confidenceThreshold;
        })
        .map(prediction => {
            const [x, y, width, height] = prediction.bbox;
            let label = prediction.class;
            
            // Map to our target objects if applicable
            if (targetObjectMapping[label]) {
                label = targetObjectMapping[label];
            } else if (!Object.values(targetObjectMapping).includes(label)) {
                // If not one of our target objects, return null to filter it out
                return null;
            }
            
            // Skip if this object type is toggled off
            if (!detectionToggles[label]) {
                return null;
            }
            
            // Calculate center point for tracking
            const centerX = x + width / 2;
            const centerY = y + height / 2;
            
            // Create a unique ID based on class and position
            const objectId = `${label}_${Math.round(centerX)}_${Math.round(centerY)}`;
            
            // Check if this object was previously tracked
            let trackId;
            let matchedId = null;
            
            // Look for the closest match among tracked objects of the same type
            let minDistance = Infinity;
            
            for (const id in trackedObjects) {
                const tracked = trackedObjects[id];
                if (tracked.type === label) {
                    // Calculate distance to previously tracked object
                    const dx = tracked.centerX - centerX;
                    const dy = tracked.centerY - centerY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // If within reasonable distance, consider it the same object
                    if (distance < Math.min(width, height) * 0.5 && distance < minDistance) {
                        minDistance = distance;
                        matchedId = id;
                    }
                }
            }
            
            if (matchedId) {
                // Update existing tracked object
                trackId = trackedObjects[matchedId].trackId;
                trackedObjects[matchedId].lastSeen = Date.now();
                trackedObjects[matchedId].centerX = centerX;
                trackedObjects[matchedId].centerY = centerY;
            } else {
                // Create new tracked object
                trackId = nextTrackId++;
                trackedObjects[objectId] = {
                    id: objectId,
                    trackId: trackId,
                    type: label,
                    lastSeen: Date.now(),
                    centerX: centerX,
                    centerY: centerY
                };
            }
            
            // Additional refinement for Rabbit R1 detection
            // This helps distinguish Rabbit R1 from other similar objects
            if (label === 'Rabbit R1') {
                // Check aspect ratio - Rabbit R1 is typically more square
                const aspectRatio = width / height;
                if (aspectRatio < 0.7 || aspectRatio > 1.3) {
                    // Reduce confidence for objects with non-square aspect ratio
                    prediction.score *= 0.8;
                }
                
                // Check size - Rabbit R1 is typically not very small
                const objectSize = width * height;
                const screenSize = canvas.width * canvas.height;
                const sizeRatio = objectSize / screenSize;
                
                if (sizeRatio < 0.01) {
                    // Reduce confidence for very small objects
                    prediction.score *= 0.7;
                }
            }
            
            return {
                label: label,
                bbox: [x, y, width, height],
                score: prediction.score,
                trackId: trackId,
                centerX: centerX,
                centerY: centerY
            };
        })
        .filter(obj => obj !== null); // Remove null entries
}

/**
 * Clean up old tracked objects
 */
function cleanupTrackedObjects() {
    const now = Date.now();
    const maxAge = 1000; // 1 second
    
    for (const id in trackedObjects) {
        if (now - trackedObjects[id].lastSeen > maxAge) {
            delete trackedObjects[id];
        }
    }
}

/**
 * Find the best object to lock onto
 * @param {Array} objects - Detected objects
 * @returns {Object|null} Best object to lock onto, or null if none
 */
function findTargetLock(objects) {
    if (objects.length === 0) return null;
    
    // Prefer objects with higher confidence
    objects.sort((a, b) => b.score - a.score);
    
    // Find the object closest to the center of the screen
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    let closestObject = null;
    let minDistance = Infinity;
    
    for (const obj of objects) {
        const objCenterX = obj.centerX;
        const objCenterY = obj.centerY;
        
        const dx = objCenterX - centerX;
        const dy = objCenterY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestObject = obj;
        }
    }
    
    return closestObject;
}

/**
 * Update target lock display
 * @param {Object|null} target - Target object to lock onto
 */
function updateTargetLock(target) {
    if (target) {
        targetLockElement.style.display = 'block';
        targetLockElement.style.left = `${target.centerX}px`;
        targetLockElement.style.top = `${target.centerY}px`;
        targetLockElement.style.transform = 'translate(-50%, -50%)';
        
        // Determine color based on confidence
        let color = '#00ff00'; // Default green for high confidence
        if (target.score < 0.5) {
            color = '#ff0000'; // Red for low confidence
        } else if (target.score < 0.7) {
            color = '#ffff00'; // Yellow for medium confidence
        }
        
        // Adjust color based on HUD style
        if (hudStyle === 'amber') {
            color = target.score < 0.5 ? '#ff0000' : (target.score < 0.7 ? '#ffbf00' : '#ffbf00');
        } else if (hudStyle === 'blue') {
            color = target.score < 0.5 ? '#ff0000' : (target.score < 0.7 ? '#00ccff' : '#00ccff');
        }
        
        targetLockElement.style.borderColor = color;
        
        // Add target information
        const targetInfoElement = document.createElement('div');
        targetInfoElement.style.position = 'absolute';
        targetInfoElement.style.top = '100%';
        targetInfoElement.style.left = '50%';
        targetInfoElement.style.transform = 'translateX(-50%)';
        targetInfoElement.style.color = color;
        targetInfoElement.style.backgroundColor = 'rgba(0, 20, 0, 0.7)';
        targetInfoElement.style.padding = '2px 5px';
        targetInfoElement.style.fontSize = '10px';
        targetInfoElement.style.whiteSpace = 'nowrap';
        targetInfoElement.textContent = `TARGET: ${target.label} #${target.trackId}`;
        
        // Remove any existing target info
        const existingInfo = targetLockElement.querySelector('div');
        if (existingInfo) {
            existingInfo.remove();
        }
        
        targetLockElement.appendChild(targetInfoElement);
    } else {
        targetLockElement.style.display = 'none';
    }
}

/**
 * Update performance indicator
 * @param {number} fps - Current frames per second
 */
function updatePerformanceIndicator(fps) {
    // Keep a history of FPS values
    performanceHistory.push(fps);
    if (performanceHistory.length > 30) {
        performanceHistory.shift();
    }
    
    // Calculate average FPS
    const avgFps = performanceHistory.reduce((sum, value) => sum + value, 0) / performanceHistory.length;
    
    // Calculate performance level (0-100%)
    const maxExpectedFps = 30; // Adjust based on device capabilities
    const performanceLevel = Math.min(100, (avgFps / maxExpectedFps) * 100);
    
    // Update performance level indicator
    performanceLevelElement.style.width = `${performanceLevel}%`;
    
    // Set color based on performance level
    if (performanceLevel < 50) {
        performanceLevelElement.style.backgroundColor = '#ff0000'; // Red for poor performance
        
        // Suggest performance mode if not already enabled
        if (!performanceMode && performanceHistory.length > 10 && avgFps < 15) {
            showWarning('Low performance detected. Consider enabling Performance Mode.');
        }
    } else if (performanceLevel < 75) {
        performanceLevelElement.style.backgroundColor = '#ffff00'; // Yellow for medium performance
    } else {
        // Use the current HUD style color for good performance
        if (hudStyle === 'green') {
            performanceLevelElement.style.backgroundColor = '#00ff00';
        } else if (hudStyle === 'amber') {
            performanceLevelElement.style.backgroundColor = '#ffbf00';
        } else if (hudStyle === 'blue') {
            performanceLevelElement.style.backgroundColor = '#00ccff';
        }
    }
}

/**
 * Main detection loop
 * @param {number} timestamp - Current timestamp
 */
async function detectObjects(timestamp) {
    // Calculate FPS
    if (lastFrameTime) {
        fps = Math.round(1000 / (timestamp - lastFrameTime));
        fpsElement.textContent = `FPS: ${fps}`;
        
        // Update performance indicator
        updatePerformanceIndicator(fps);
    }
    lastFrameTime = timestamp;
    
    if (isVideoLoaded && isModelLoaded) {
        try {
            // Process the current video frame with MediaPipe Hands
            if (hands && detectionToggles["Hand"]) {
                await hands.send({image: video});
            }
            
            // Skip some frames in performance mode
            frameCounter++;
            const skipFrames = performanceMode ? 2 : 0; // Skip every other frame in performance mode
            
            if (frameCounter % (skipFrames + 1) === 0) {
                // Process the current video frame with COCO-SSD
                const predictions = await cocoSsdModel.detect(video);
                const refinedPredictions = refineDetections(predictions);
                
                // Update detected objects with COCO-SSD results
                // First, filter out non-hand objects
                detectedObjects = detectedObjects.filter(obj => obj.label.includes('Hand'));
                
                // Then add the refined COCO-SSD predictions
                detectedObjects = [...detectedObjects, ...refinedPredictions];
                
                // Update detection statistics
                updateDetectionStatistics(refinedPredictions);
            }
            
            // Clean up old tracked objects
            cleanupTrackedObjects();
            
            // Find the best object to lock onto
            targetLock = findTargetLock(detectedObjects);
            
            // Update target lock display
            updateTargetLock(targetLock);
            
            // Update detection status
            updateDetectionStatus();
            
            // Draw the video frame on the canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Draw bounding boxes for all detected objects
            detectedObjects.forEach(drawBoundingBox);
            
        } catch (error) {
            console.error('Error in detection loop:', error);
            
            // Handle specific errors
            if (error.name === 'NotReadableError') {
                showError('Camera stream not readable. The camera might be in use by another application.');
            } else if (error.message && error.message.includes('memory')) {
                showError('Out of memory. Try enabling Performance Mode or using a device with more resources.');
                
                // Automatically enable performance mode
                if (!performanceMode) {
                    performanceMode = true;
                    togglePerformanceElement.classList.add('active');
                    togglePerformanceElement.textContent = 'ON';
                    document.getElementById('scan-lines').style.opacity = '0';
                }
            } else {
                // For other errors, just log to console without interrupting the user
                console.warn('Recoverable error in detection loop:', error);
            }
        }
    }
    
    // Continue the detection loop
    requestAnimationFrame(detectObjects);
}

/**
 * Update detection statistics
 * @param {Array} predictions - Refined predictions
 */
function updateDetectionStatistics(predictions) {
    // Reset counts for non-hand objects
    detectionStats["Rabbit R1"].count = 0;
    detectionStats["Measuring Tape"].count = 0;
    detectionStats["Water Bottle"].count = 0;
    
    // Update statistics based on new predictions
    predictions.forEach(obj => {
        if (detectionStats[obj.label]) {
            detectionStats[obj.label].count++;
            
            // Update running average of confidence
            const currentConfidence = detectionStats[obj.label].confidence;
            const currentCount = detectionStats[obj.label].count;
            
            // Weighted average to smooth confidence values
            detectionStats[obj.label].confidence = 
                (currentConfidence * (currentCount - 1) + obj.score) / currentCount;
        }
    });
}

/**
 * Display error message
 * @param {string} message - Error message to display
 */
function showError(message) {
    errorMessageElement.textContent = message;
    errorMessageElement.style.display = 'block';
    errorMessageElement.style.backgroundColor = 'rgba(50, 0, 0, 0.9)';
    errorMessageElement.style.color = '#ff0000';
    loadingElement.style.display = 'none';
    statusElement.textContent = 'SYSTEM: ERROR';
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
        errorMessageElement.style.display = 'none';
    }, 10000);
}

/**
 * Display warning message
 * @param {string} message - Warning message to display
 */
function showWarning(message) {
    errorMessageElement.textContent = message;
    errorMessageElement.style.display = 'block';
    errorMessageElement.style.backgroundColor = 'rgba(50, 50, 0, 0.9)';
    errorMessageElement.style.color = '#ffff00';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorMessageElement.style.display = 'none';
    }, 5000);
}

/**
 * Handle window resize
 */
window.addEventListener('resize', () => {
    if (canvas) {
        const videoContainer = document.getElementById('video-container');
        canvas.width = videoContainer.offsetWidth;
        canvas.height = videoContainer.offsetHeight;
    }
});

/**
 * Load saved preferences from localStorage
 */
function loadSavedPreferences() {
    try {
        // Load HUD style
        const savedHudStyle = localStorage.getItem('hudStyle');
        if (savedHudStyle) {
            if (savedHudStyle === 'green') {
                styleGreenElement.click();
            } else if (savedHudStyle === 'amber') {
                styleAmberElement.click();
            } else if (savedHudStyle === 'blue') {
                styleBlueElement.click();
            }
        }
        
        // Load confidence threshold
        const savedConfidenceThreshold = localStorage.getItem('confidenceThreshold');
        if (savedConfidenceThreshold) {
            confidenceThreshold = parseFloat(savedConfidenceThreshold);
            confidenceSliderElement.value = confidenceThreshold * 100;
            confidenceValueElement.textContent = confidenceThreshold.toFixed(2);
        }
        
        // Load performance mode
        const savedPerformanceMode = localStorage.getItem('performanceMode');
        if (savedPerformanceMode === 'true') {
            performanceMode = true;
            togglePerformanceElement.classList.add('active');
            togglePerformanceElement.textContent = 'ON';
            document.getElementById('scan-lines').style.opacity = '0';
        }
    } catch (e) {
        console.warn('Could not load saved preferences:', e);
    }
}

/**
 * Save preferences to localStorage
 */
function savePreferences() {
    try {
        localStorage.setItem('hudStyle', hudStyle);
        localStorage.setItem('confidenceThreshold', confidenceThreshold.toString());
        localStorage.setItem('performanceMode', performanceMode.toString());
    } catch (e) {
        console.warn('Could not save preferences:', e);
    }
}

// Load saved preferences when the page loads
document.addEventListener('DOMContentLoaded', loadSavedPreferences);

// Save preferences when the page is unloaded
window.addEventListener('beforeunload', savePreferences);

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkBrowserCompatibility,
        refineDetections,
        updatePerformanceIndicator
    };
}
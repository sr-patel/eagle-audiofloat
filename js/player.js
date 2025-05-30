// Initialize the player when the window loads
let audioPlayerInstance = null;

// Wait for Eagle plugin to be ready
if (window.eagle) {
    eagle.onPluginCreate((plugin) => {
        console.log('Audio Player plugin created:', plugin);
        if (!audioPlayerInstance) {
            audioPlayerInstance = new AudioPlayer();
            window.audioPlayer = audioPlayerInstance;
        }
    });
} else {
    // Fallback for development/testing without Eagle
window.addEventListener('load', () => {
    if (!audioPlayerInstance) {
        audioPlayerInstance = new AudioPlayer();
        window.audioPlayer = audioPlayerInstance;
    }
});
}

class AudioPlayer {
    constructor() {
        // Check if an instance already exists
        if (window.audioPlayer) {
            console.log('Audio Player already initialized');
            return;
        }

        this.audio = null;  // Will be created for each track
        this.isPlaying = false;
        this.currentTrack = null;
        this.playlist = [];
        this.currentIndex = -1;  // Initialize to -1 to indicate no track selected
        this.volume = parseFloat(localStorage.getItem('volume')) || 1;
        this.isMuted = false;
        this.isPinned = localStorage.getItem('isPinned') === 'true';
        this.positionRestored = false; // Add flag for position restoration
        this.colors = {
            background: '#1a0f2e',
            accent: '#9d4edd',
            text: '#ffffff',
            visualizerStart: '#9d4edd',
            visualizerEnd: '#ff85a2'
        };

        // Theme settings
        this.currentTheme = localStorage.getItem('theme') || 'dark-purple';
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        // Defer reading CSS variables until after theme is applied
        setTimeout(() => {
            this.setTheme(this.currentTheme);
        }, 0);

        // Background settings
        this.backgroundImage = null;
        this.backgroundImages = [];
        this.backgroundImageColors = [];
        this.themeBestMatches = JSON.parse(localStorage.getItem('themeBestMatches')) || {};
        this.backgroundBlur = parseInt(localStorage.getItem('backgroundBlur')) || 10;
        this.useCustomBackground = localStorage.getItem('useCustomBackground') === 'true';
        this.backgroundOpacity = parseFloat(localStorage.getItem('backgroundOpacity')) || 0.75;
        this.currentBackgroundIndex = 0;

        // Initialize IndexedDB
        this.initIndexedDB().then(() => {
            // Load saved background images on startup
            this.loadSavedBackgroundImages();
        });

        // Initialize audio context and analyzer
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        this.mediaSource = null;  // Store the media source

        // Initialize canvas
        this.canvas = document.getElementById('visualizer');
        this.canvasCtx = this.canvas.getContext('2d');
        this.resizeCanvas();

        this.loadingContainer = document.querySelector('.loading-container');
        this.loadingProgress = document.querySelector('.loading-progress');

        this.isShuffled = false;
        this.isLooped = false;
        this.shuffledPlaylist = [];

        this.subtitles = null;
        this.subtitleCues = [];
        this.currentSubtitle = null;
        this.isSubtitleEnabled = false;

        // Spiral settings from localStorage or defaults
        this.spiralThickness = parseFloat(localStorage.getItem('spiralThickness')) || 2.5;
        this.spiralSpeed = parseInt(localStorage.getItem('spiralSpeed')) || 6000;
        this.spiralSegment = parseFloat(localStorage.getItem('spiralSegment')) || 0.45;

        // Visualizer settings
        this.visualizerStyle = localStorage.getItem('visualizerStyle') || 'bars';
        this.visualizerColor = localStorage.getItem('visualizerColor') || this.colors.accent;
        this.visualizerReactivity = parseFloat(localStorage.getItem('visualizerReactivity')) || 5;
        this.visualizerSmoothing = parseFloat(localStorage.getItem('visualizerSmoothing')) || 0.5;
        this.particles = [];
        this.previousDataArray = new Uint8Array(this.bufferLength);

        this.initializeElements();
        this.initializeEventListeners();
        this.initializeEagleIntegration();
        this.drawVisualizer();

        // Apply saved background settings
        if (this.useCustomBackground && this.backgroundImage) {
            this.applyBackground(this.backgroundImage);
        }

        // Ensure pinned state is properly set on startup
        if (this.isPinned) {
            setTimeout(() => {
                this.setAlwaysOnTop(true);
            }, 500);
        }

        // Subtitle settings
        this.subtitleSize = parseInt(localStorage.getItem('subtitleSize')) || 16;
        this.subtitleColor = localStorage.getItem('subtitleColor') || '#ffffff';
        this.subtitleBackground = localStorage.getItem('subtitleBackground') || '#000000';
        this.subtitleOpacity = parseInt(localStorage.getItem('subtitleOpacity')) || 50;
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            // Increment version to force upgrade
            const request = indexedDB.open('AudioFloatDB', 3);

        request.onerror = (event) => {
                console.error('Error opening IndexedDB:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IndexedDB initialized successfully');
                resolve();
        };

        request.onupgradeneeded = (event) => {
                console.log('Upgrading IndexedDB...');
            const db = event.target.result;
                
                // Create object store for background images
            if (!db.objectStoreNames.contains('backgroundImages')) {
                    console.log('Creating backgroundImages store...');
                    const store = db.createObjectStore('backgroundImages', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
            }

                // Create object store for playback positions
            if (!db.objectStoreNames.contains('playbackPositions')) {
                    console.log('Creating playbackPositions store...');
                    const store = db.createObjectStore('playbackPositions', { keyPath: 'fileId' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async saveBackgroundImages(images) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['backgroundImages'], 'readwrite');
            const store = transaction.objectStore('backgroundImages');

            // Clear existing images
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => {
                // Save new images
                const savePromises = images.map((imageUrl, index) => {
                    return new Promise((resolve, reject) => {
                        const request = store.add({
                            url: imageUrl,
                            timestamp: Date.now(),
                            index: index,
                            colors: this.backgroundImageColors[index]
                        });
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                });
            });

                Promise.all(savePromises)
                    .then(() => resolve())
                    .catch(reject);
            };
            clearRequest.onerror = () => reject(clearRequest.error);
        });
    }

    async loadBackgroundImages() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['backgroundImages'], 'readonly');
            const store = transaction.objectStore('backgroundImages');
            const request = store.getAll();

            request.onsuccess = () => {
                const images = request.result.sort((a, b) => a.index - b.index);
                this.backgroundImages = images.map(img => img.url);
                this.backgroundImageColors = images.map(img => img.colors);
                
                // Load theme assignments
                this.themeBestMatches = JSON.parse(localStorage.getItem('themeBestMatches')) || {};
                
                resolve(this.backgroundImages);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async removeBackgroundImages() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['backgroundImages'], 'readwrite');
            const store = transaction.objectStore('backgroundImages');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    initializeElements() {
        // Create loading overlay
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        // Generate a single spiral path around a sphere, with true 3D projection
        function generate3DSphereSpiralPath(cx, cy, r, turns, points, rotX = Math.PI/6, rotY = Math.PI/6) {
            let d = '';
            for (let i = 0; i <= points; i++) {
                // Parametric spiral on a sphere
                const t = (i / points) * Math.PI * 2 * turns;
                const phi = (i / points) * Math.PI; // latitude
                const theta = t; // longitude
                // Spherical to Cartesian (3D)
                let x = r * Math.sin(phi) * Math.cos(theta);
                let y = r * Math.sin(phi) * Math.sin(theta);
                let z = r * Math.cos(phi);
                // 3D rotation around X axis
                let y1 = y * Math.cos(rotX) - z * Math.sin(rotX);
                let z1 = y * Math.sin(rotX) + z * Math.cos(rotX);
                y = y1;
                z = z1;
                // 3D rotation around Y axis
                let x1 = x * Math.cos(rotY) + z * Math.sin(rotY);
                z1 = -x * Math.sin(rotY) + z * Math.cos(rotY);
                x = x1;
                z = z1;
                // Perspective projection (optional, here just orthographic)
                const x2d = cx + x;
                const y2d = cy + y;
                if (i === 0) {
                    d = `M${x2d},${y2d}`;
                } else {
                    d += ` L${x2d},${y2d}`;
                }
            }
            return d;
        }
        const spiralPath = generate3DSphereSpiralPath(160, 160, 128, 14, 1000, Math.PI/5, Math.PI/6);
        // Use theme accent color for the spiral
        const accentColor = this.colors && this.colors.accent ? this.colors.accent : '#39ff14';
        const gradientId = 'spiral-gradient';
        loadingOverlay.innerHTML = `
            <div class="loading-animation">
                <svg viewBox="0 0 320 320" class="loading-sphere" width="320" height="320">
                    <defs>
                        <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stop-color="${accentColor}" stop-opacity="0"/>
                            <stop offset="20%" stop-color="${accentColor}" stop-opacity="1"/>
                            <stop offset="80%" stop-color="${accentColor}" stop-opacity="1"/>
                            <stop offset="100%" stop-color="${accentColor}" stop-opacity="0"/>
                        </linearGradient>
                    </defs>
                    <path class="sphere-spiral" d="${spiralPath}" stroke="url(#${gradientId})" stroke-width="${this.spiralThickness}" fill="none"/>
                </svg>
            </div>
        `;
        document.body.appendChild(loadingOverlay);

        // Add loading overlay styles
        const style = document.createElement('style');
        style.textContent = `
            .loading-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: var(--theme-overlay-bg, rgba(26, 15, 46, 0.9));
                backdrop-filter: blur(10px);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 9999;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }
            .loading-overlay.show {
                opacity: 1;
                visibility: visible;
            }
            .loading-animation {
                width: 320px;
                height: 320px;
                margin-bottom: 20px;
            }
            .loading-sphere {
                width: 100%;
                height: 100%;
                display: block;
            }
            .sphere-spiral {
                /* No drop-shadow */
            }
        `;
        document.head.appendChild(style);

        this.loadingOverlay = loadingOverlay;
        this.loadingSpiral = loadingOverlay.querySelector('.sphere-spiral');
        const loadingAnimationDiv = loadingOverlay.querySelector('.loading-animation');

        // After the SVG is in the DOM, get the path length
        const pathLength = this.loadingSpiral.getTotalLength();
        // Set the dasharray to a longer segment (45% of the path)
        const segmentLength = pathLength * this.spiralSegment;
        this.loadingSpiral.setAttribute('stroke-dasharray', `${segmentLength} ${pathLength}`);
        this.loadingSpiral.setAttribute('stroke-dashoffset', '0');

        // Animate the dashoffset to move the segment along the path, seamless back-and-forth
        this.loadingAnimation = anime({
            targets: this.loadingSpiral,
            strokeDashoffset: [0, -pathLength],
            easing: 'linear',
            duration: this.spiralSpeed,
            direction: 'alternate',
            loop: true
        });

        // Ambient floating animation for the spiral container
        this.floatingAnimation = anime({
            targets: loadingAnimationDiv,
            translateX: [0, 12, -10, 0],
            translateY: [0, -10, 8, 0],
            rotate: [0, 2, -2, 0],
            easing: 'easeInOutSine',
            duration: 7000,
            direction: 'alternate',
            loop: true
        });

        // Wire up spiral thickness and speed controls
        const thicknessSlider = document.getElementById('spiral-thickness');
        const thicknessValue = document.getElementById('spiral-thickness-value');
        const speedSlider = document.getElementById('spiral-speed');
        const speedValue = document.getElementById('spiral-speed-value');
        if (thicknessSlider && thicknessValue) {
            thicknessSlider.value = this.spiralThickness;
            thicknessValue.textContent = this.spiralThickness;
            thicknessSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.spiralThickness = val;
                thicknessValue.textContent = val;
                this.loadingSpiral.setAttribute('stroke-width', val);
                localStorage.setItem('spiralThickness', val);
            });
        }
        if (speedSlider && speedValue) {
            speedSlider.value = this.spiralSpeed;
            speedValue.textContent = this.spiralSpeed;
            speedSlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                this.spiralSpeed = val;
                speedValue.textContent = val;
                this.loadingAnimation.duration = val;
                localStorage.setItem('spiralSpeed', val);
            });
        }
        // Ensure spiral color matches theme on first load
        this.updateSpiralColor();

        this.playBtn = document.getElementById('play-btn');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        this.muteBtn = document.getElementById('mute-btn');
        this.volumeSlider = document.getElementById('volume-slider');
        this.progressBar = document.querySelector('.progress-bar');
        this.progress = document.querySelector('.progress');
        this.currentTimeEl = document.querySelector('.current-time');
        this.totalTimeEl = document.querySelector('.total-time');
        this.trackTitle = document.querySelector('.track-title');
        this.trackArtist = document.querySelector('.track-artist');
        this.fileType = document.querySelector('.file-type');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsModal = document.getElementById('settings-modal');
        this.closeSettingsBtn = document.getElementById('close-settings');
        this.pinBtn = document.getElementById('pin-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.resetBackgroundBtn = document.getElementById('reset-background');
        this.listeningHistory = document.querySelector('.listening-history');
        this.lastListened = document.querySelector('.last-listened');
        this.lastPosition = document.querySelector('.last-position');

        // Set initial values
        this.volumeSlider.value = this.volume * 100;
        this.volumeSlider.style.setProperty('--volume-level', `${this.volume * 100}%`);

        // Set initial pin state
        if (this.isPinned) {
            this.pinBtn.classList.add('active');
            this.setAlwaysOnTop(true);
        }

        // Show reset button if we have background images
        if (this.resetBackgroundBtn && this.backgroundImages.length > 0) {
            this.resetBackgroundBtn.style.display = 'block';
        }

        // Add window resize listener
        window.addEventListener('resize', () => this.resizeCanvas());

        this.shuffleBtn = document.getElementById('shuffle-btn');
        this.loopBtn = document.getElementById('loop-btn');
        this.nextTrackTitle = document.querySelector('.next-title');

        this.subtitleBtn = document.getElementById('subtitle-btn');
        this.subtitleText = document.querySelector('.subtitle-text');
        this.subtitleContainer = document.querySelector('.subtitle-container');

        // Add new spiral segment length setting
        const segmentSlider = document.getElementById('spiral-segment');
        const segmentValue = document.getElementById('spiral-segment-value');
        if (segmentSlider && segmentValue) {
            segmentSlider.value = this.spiralSegment;
            segmentValue.textContent = Math.round(this.spiralSegment * 100);
            segmentSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.spiralSegment = val;
                segmentValue.textContent = Math.round(val * 100);
                const segLen = pathLength * val;
                this.loadingSpiral.setAttribute('stroke-dasharray', `${segLen} ${pathLength}`);
                localStorage.setItem('spiralSegment', val);
            });
        }

        // Visualizer settings
        this.visualizerStyleSelect = document.getElementById('visualizer-style');
        this.visualizerColorInput = document.getElementById('visualizer-color');
        this.visualizerReactivitySlider = document.getElementById('visualizer-reactivity');
        this.visualizerReactivityValue = document.getElementById('visualizer-reactivity-value');
        this.visualizerSmoothingSlider = document.getElementById('visualizer-smoothing');
        this.visualizerSmoothingValue = document.getElementById('visualizer-smoothing-value');

        // Set initial values
        this.visualizerStyleSelect.value = this.visualizerStyle;
        this.visualizerColorInput.value = this.visualizerColor;
        this.visualizerReactivitySlider.value = this.visualizerReactivity;
        this.visualizerReactivityValue.textContent = this.visualizerReactivity;
        this.visualizerSmoothingSlider.value = this.visualizerSmoothing;
        this.visualizerSmoothingValue.textContent = this.visualizerSmoothing;

        // Add event listeners
        this.visualizerStyleSelect.addEventListener('change', (e) => {
            this.visualizerStyle = e.target.value;
            localStorage.setItem('visualizerStyle', this.visualizerStyle);
        });

        this.visualizerColorInput.addEventListener('input', (e) => {
            this.visualizerColor = e.target.value;
            localStorage.setItem('visualizerColor', this.visualizerColor);
        });

        this.visualizerReactivitySlider.addEventListener('input', (e) => {
            this.visualizerReactivity = parseFloat(e.target.value);
            this.visualizerReactivityValue.textContent = this.visualizerReactivity;
            localStorage.setItem('visualizerReactivity', this.visualizerReactivity);
        });

        this.visualizerSmoothingSlider.addEventListener('input', (e) => {
            this.visualizerSmoothing = parseFloat(e.target.value);
            this.visualizerSmoothingValue.textContent = this.visualizerSmoothing;
            localStorage.setItem('visualizerSmoothing', this.visualizerSmoothing);
        });

        // Background settings
        this.backgroundImageInput = document.getElementById('background-image');
        this.backgroundFolderInput = document.getElementById('background-folder');
        this.backgroundBlurSlider = document.getElementById('background-blur');
        this.backgroundBlurValue = document.getElementById('background-blur-value');
        this.backgroundOpacitySlider = document.getElementById('background-opacity');
        this.backgroundOpacityValue = document.getElementById('background-opacity-value');
        this.customBackgroundToggle = document.getElementById('custom-background-toggle');
        this.backgroundOptions = document.querySelector('.background-options');
        this.removeBackgroundBtn = document.getElementById('remove-background');
        this.audioPlayer = document.querySelector('.audio-player');

        console.log('Background elements initialized:', {
            hasImageInput: !!this.backgroundImageInput,
            hasFolderInput: !!this.backgroundFolderInput,
            hasBlurSlider: !!this.backgroundBlurSlider,
            hasOpacitySlider: !!this.backgroundOpacitySlider,
            hasCustomToggle: !!this.customBackgroundToggle,
            hasOptions: !!this.backgroundOptions,
            hasRemoveBtn: !!this.removeBackgroundBtn,
            hasAudioPlayer: !!this.audioPlayer
        });

        // Set initial values
        if (this.backgroundBlurSlider) {
            this.backgroundBlurSlider.value = this.backgroundBlur;
            if (this.backgroundBlurValue) {
                this.backgroundBlurValue.textContent = this.backgroundBlur;
            }
        }
        if (this.backgroundOpacitySlider) {
            this.backgroundOpacitySlider.value = this.backgroundOpacity * 100;
            if (this.backgroundOpacityValue) {
                this.backgroundOpacityValue.textContent = Math.round(this.backgroundOpacity * 100);
            }
        }
        if (this.customBackgroundToggle) {
            this.customBackgroundToggle.checked = this.useCustomBackground;
        }
        this.updateBackgroundOptions();

        // Apply saved background if it exists
        if (this.useCustomBackground && this.backgroundImage) {
            console.log('Applying saved background image');
            this.applyBackground(this.backgroundImage);
        }
    }

    initializeEventListeners() {
        if (this.playBtn) {
        this.playBtn.addEventListener('click', () => this.togglePlay());
        }
        if (this.prevBtn) {
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        }
        if (this.nextBtn) {
        this.nextBtn.addEventListener('click', () => this.playNext());
        }
        if (this.muteBtn) {
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        }
        if (this.volumeSlider) {
        this.volumeSlider.addEventListener('input', (e) => {
            const value = e.target.value / 100;
            this.setVolume(value);
        });
        }

        if (this.progressBar) {
        this.progressBar.addEventListener('click', (e) => this.seekTo(e));
        }

        // Add window resize handler
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            // Update next track title overflow state
            if (this.nextTrackTitle && this.nextTrackTitle.textContent) {
                const container = this.nextTrackTitle.parentElement;
                const titleWidth = this.nextTrackTitle.scrollWidth;
                const containerWidth = container.clientWidth;
                const isOverflowing = titleWidth > containerWidth + 20;
                
                // Remove any existing animation
                this.nextTrackTitle.style.animation = 'none';
                
                // Force a reflow
                void this.nextTrackTitle.offsetWidth;
                
                // Add the animation class only if overflowing
                container.classList.toggle('overflowing', isOverflowing);
                
                if (isOverflowing) {
                    // Start the scrolling animation
                    this.nextTrackTitle.style.animation = 'marquee 15s linear infinite';
                }
            }
        });

        // Add keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            
            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowLeft':
                    this.playPrevious();
                    break;
                case 'ArrowRight':
                    this.playNext();
                    break;
                case 'm':
                    this.toggleMute();
                    break;
            }
        });

        // Add drag and drop support
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const files = Array.from(e.dataTransfer.files);
            const audioFiles = files.filter(file => 
                file.type === 'audio/mpeg' || 
                file.type === 'audio/wav' || 
                file.type === 'audio/ogg' ||
                file.type === 'audio/mp3' ||
                file.type === 'audio/x-m4a' ||
                file.type === 'audio/m4a' ||
                file.type === 'audio/opus' ||
                file.type === 'audio/x-opus'
            );
            
            if (audioFiles.length > 0) {
                this.playlist = audioFiles;
                this.currentIndex = 0;
                this.loadTrack(audioFiles[0]);
            }
        });

        // Settings modal
        if (this.settingsBtn) {
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        }
        if (this.closeSettingsBtn) {
        this.closeSettingsBtn.addEventListener('click', () => this.toggleSettings());
        }
        if (this.settingsModal) {
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) {
                this.toggleSettings();
            }
        });
        }

        if (this.shuffleBtn) {
            this.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        }
        if (this.loopBtn) {
            this.loopBtn.addEventListener('click', () => this.toggleLoop());
        }

        if (this.pinBtn) {
        this.pinBtn.addEventListener('click', () => this.togglePin());
        }

        if (this.subtitleBtn) {
        this.subtitleBtn.addEventListener('click', () => this.toggleSubtitles());
        }

        // Theme selection
        const themeOptions = document.querySelectorAll('.theme-option');
        themeOptions.forEach(option => {
            option.addEventListener('click', () => {
                const theme = option.dataset.theme;
                this.setTheme(theme);
                
                // Update active state
                themeOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                    });
                });

        // Set initial active theme
        const activeThemeOption = document.querySelector(`.theme-option[data-theme="${this.currentTheme}"]`);
        if (activeThemeOption) {
            activeThemeOption.classList.add('active');
        }

        // Background folder handling
        if (this.backgroundFolderInput) {
            this.backgroundFolderInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files).filter(file => 
                    file.type.startsWith('image/')
                );
                
                if (files.length > 0) {
                    try {
                        // Clear existing backgrounds
                        this.backgroundImages = [];
                        this.backgroundImageColors = [];
                        await this.removeBackgroundImages();
                        
                        // Load all images and compute colors
                        for (const file of files) {
                            const imageUrl = await this.readFileAsDataURL(file);
                            this.backgroundImages.push(imageUrl);
                            const colors = await this.analyzeImageColors(imageUrl);
                            this.backgroundImageColors.push(colors);
                        }
                        
                        // Save to IndexedDB
                        await this.saveBackgroundImages(this.backgroundImages);
                        
                        // Find and apply a matching image
                        if (this.backgroundImages.length > 0) {
                            const matchingImage = await this.findMatchingImages(this.backgroundImages);
                            this.backgroundImage = matchingImage;
                            this.currentBackgroundIndex = this.backgroundImages.indexOf(matchingImage);
                            localStorage.setItem('backgroundImage', this.backgroundImage);
                            this.applyBackground(this.backgroundImage);
                        }
                        
                        // Show remove button
                        if (this.removeBackgroundBtn) {
                            this.removeBackgroundBtn.style.display = 'block';
                        }
                } catch (error) {
                        console.error('Error loading background folder:', error);
                }
            }
        });
        }

        // Background settings
        if (this.backgroundImageInput) {
            this.backgroundImageInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file && file.type.startsWith('image/')) {
                    try {
                        const imageUrl = await this.readFileAsDataURL(file);
                        this.backgroundImage = imageUrl;
                        localStorage.setItem('backgroundImage', imageUrl);
                        this.applyBackground(imageUrl);
                    } catch (error) {
                        console.error('Error loading background image:', error);
                    }
                }
            });
        }

        if (this.backgroundBlurSlider) {
        this.backgroundBlurSlider.addEventListener('input', (e) => {
                this.backgroundBlur = parseInt(e.target.value);
                if (this.backgroundBlurValue) {
                    this.backgroundBlurValue.textContent = this.backgroundBlur;
                }
                localStorage.setItem('backgroundBlur', this.backgroundBlur);
                this.updateBackgroundBlur();
            });
        }

        if (this.customBackgroundToggle) {
        this.customBackgroundToggle.addEventListener('change', (e) => {
            this.useCustomBackground = e.target.checked;
            localStorage.setItem('useCustomBackground', this.useCustomBackground);
            this.updateBackgroundOptions();
            
                if (this.useCustomBackground && this.backgroundImage) {
                    this.applyBackground(this.backgroundImage);
            } else {
                    this.removeBackground();
                }
            });
        }

        if (this.removeBackgroundBtn) {
            this.removeBackgroundBtn.addEventListener('click', () => {
                this.removeBackground();
                this.backgroundImage = null;
                localStorage.removeItem('backgroundImage');
            });
        }

        if (this.backgroundOpacitySlider) {
            this.backgroundOpacitySlider.addEventListener('input', (e) => {
                const opacity = parseFloat(e.target.value) / 100;
                this.backgroundOpacity = opacity;
                if (this.backgroundOpacityValue) {
                    this.backgroundOpacityValue.textContent = Math.round(opacity * 100);
                }
                localStorage.setItem('backgroundOpacity', opacity);
                this.updateBackgroundOpacity();
            });
        }

        if (this.resetBackgroundBtn) {
            this.resetBackgroundBtn.addEventListener('click', async () => {
                if (this.backgroundImages.length > 0) {
                    try {
                        const matchingImage = await this.findMatchingImages(this.backgroundImages);
                        if (matchingImage) {
                            this.backgroundImage = matchingImage;
                            this.currentBackgroundIndex = this.backgroundImages.indexOf(matchingImage);
                            localStorage.setItem('backgroundImage', this.backgroundImage);
                            this.applyBackground(this.backgroundImage);
                        }
                    } catch (error) {
                        console.error('Error resetting background:', error);
                    }
                }
            });
        }

        if (this.resetBtn) {
            this.resetBtn.addEventListener('click', async () => {
                console.log('Reset button clicked');
                if (this.backgroundImages.length > 0) {
                    console.log('Background images available:', this.backgroundImages.length);
                    try {
                        // Find a matching image for the current theme
                        const matchingImage = await this.findMatchingImages(this.backgroundImages);
                        console.log('Matching image found:', matchingImage);
                        if (matchingImage) {
                            this.backgroundImage = matchingImage;
                            this.currentBackgroundIndex = this.backgroundImages.indexOf(matchingImage);
                            localStorage.setItem('backgroundImage', this.backgroundImage);
                            this.applyBackground(this.backgroundImage);
                        }
                    } catch (error) {
                        console.error('Error resetting background:', error);
                    }
                } else {
                    console.log('No background images available');
                }
            });
        }

        // Subtitle settings
        const subtitleToggle = document.getElementById('subtitle-toggle');
        const subtitleSize = document.getElementById('subtitle-size');
        const subtitleSizeValue = document.getElementById('subtitle-size-value');
        const subtitleColor = document.getElementById('subtitle-color');

        // Initialize subtitle settings
        subtitleToggle.checked = this.isSubtitleEnabled;
        subtitleSize.value = this.subtitleSize;
        subtitleSizeValue.textContent = `${this.subtitleSize}px`;
        subtitleColor.value = this.subtitleColor;

        // Apply initial subtitle styles
        this.updateSubtitleStyles();

        // Subtitle toggle
        subtitleToggle.addEventListener('change', () => {
            this.toggleSubtitles();
        });

        // Subtitle size
        subtitleSize.addEventListener('input', () => {
            this.subtitleSize = parseInt(subtitleSize.value);
            subtitleSizeValue.textContent = `${this.subtitleSize}px`;
            localStorage.setItem('subtitleSize', this.subtitleSize);
            this.updateSubtitleStyles();
        });

        // Subtitle color
        subtitleColor.addEventListener('input', () => {
            this.subtitleColor = subtitleColor.value;
            localStorage.setItem('subtitleColor', this.subtitleColor);
            this.updateSubtitleStyles();
        });
    }

    async initializeEagleIntegration() {
        if (!window.eagle) return;

        try {
        eagle.onPluginRun(async () => {
            console.log('Audio Player plugin running');
            // Only load files if we don't have any in the playlist
            if (this.playlist.length === 0) {
                await this.loadFilesFromEagle();
            }
        });

        eagle.onPluginShow(async () => {
            console.log('Audio Player plugin shown');
            // Restore window state when plugin is shown
            if (this.isPinned) {
                await this.setAlwaysOnTop(true);
            }
        });

        // Handle file opening
        window.addEventListener('message', async (event) => {
            const data = event.data;
            console.log('Received message:', data);
            
            if (data && data.type === 'eagle:open') {
                await this.loadFilesFromEagle();
            }
        });
        } catch (error) {
            console.error('Error initializing Eagle integration:', error);
        }
    }

    async loadFilesFromEagle() {
        try {
            console.log('Loading files from Eagle...');
            const files = await eagle.item.getSelected();
            console.log('Raw file objects:', JSON.stringify(files, null, 2));
            
            if (!files || files.length === 0) {
                console.log('No files selected');
                return;
            }

            // First, find all VTT files using the same filtering approach as audio files
            const vttFiles = files.filter(file => {
                const isVtt = file.ext.toLowerCase() === 'vtt' || 
                            (file.type && (
                                file.type === 'text/vtt' ||
                                file.type === 'text/plain' ||
                                file.type === 'application/x-subrip'
                            ));
                console.log(`File ${file.name} is VTT:`, isVtt);
                return isVtt;
            });
            console.log('Found VTT files:', vttFiles.map(f => ({
                name: f.name,
                type: f.type,
                ext: f.ext,
                fileURL: f.fileURL
            })));

            // Create a map of audio files to their VTT files
            const audioToVttMap = new Map();
            vttFiles.forEach(vttFile => {
                const baseName = vttFile.name.replace(/\.vtt$/i, '');
                console.log('VTT file base name:', baseName);
                audioToVttMap.set(baseName, vttFile);
            });

            const audioFiles = files.filter(file => {
                const isAudio = file.ext.toLowerCase() === 'm4a' || 
                              file.ext.toLowerCase() === 'mp3' || 
                              file.ext.toLowerCase() === 'wav' || 
                              file.ext.toLowerCase() === 'ogg' ||
                              file.ext.toLowerCase() === 'opus' ||
                              (file.type && (
                                  file.type === 'audio/mpeg' || 
                                  file.type === 'audio/wav' || 
                                  file.type === 'audio/ogg' ||
                                  file.type === 'audio/mp3' ||
                                  file.type === 'audio/x-m4a' ||
                                  file.type === 'audio/m4a' ||
                                  file.type === 'audio/opus' ||
                                  file.type === 'audio/x-opus'
                              ));
                console.log(`File ${file.name} is audio:`, isAudio);
                return isAudio;
            }).map(audioFile => {
                // Add subtitle information if available
                const baseName = audioFile.name.replace(/\.[^.]+$/, '');
                console.log('Audio file base name:', baseName);
                const vttFile = audioToVttMap.get(baseName);
                if (vttFile) {
                    console.log('Found matching VTT file for:', audioFile.name);
                    audioFile.subtitles = vttFile.fileURL;
                } else {
                    console.log('No matching VTT file found for:', audioFile.name);
                }
                return audioFile;
            });
            
            console.log('Filtered audio files with subtitle info:', audioFiles.map(f => ({
                name: f.name,
                hasSubtitles: !!f.subtitles,
                subtitleUrl: f.subtitles
            })));
            
            if (audioFiles.length > 0) {
                this.playlist = audioFiles;
                this.currentIndex = 0;  // Start with the first track
                await this.loadTrack(audioFiles[0]);
            }
        } catch (error) {
            console.error('Error loading files from Eagle:', error);
        }
    }

    async loadTrack(file) {
        try {
            await this.ensureDatabaseReady();
            this.showLoading();
            this.updateLoadingProgress(0);
            this.positionRestored = false; // Reset position restoration flag
            
            // Store the current track
            this.currentTrack = file;
            
            console.log('Loading track:', file.name);
            console.log('Subtitle file URL:', file.subtitles);
            
            // Create a new audio element
            this.audio = new Audio();
            this.audio.volume = this.volume;
            this.audio.muted = this.isMuted;

            // Add audio event listeners
            this.audio.addEventListener('timeupdate', () => this.updateProgress());
            this.audio.addEventListener('ended', () => this.playNext());
            this.audio.addEventListener('loadedmetadata', () => this.updateTotalTime());
            
            // For files from Eagle
            if (file.fileURL) {
                console.log('Loading from fileURL:', file.fileURL);
                const response = await fetch(file.fileURL);
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                this.audio.src = blobUrl;
            } 
            // For regular File objects
            else if (file instanceof File) {
                console.log('Loading from File object');
                const blobUrl = URL.createObjectURL(file);
                this.audio.src = blobUrl;
            }
            
            // Set up loading progress tracking
            this.audio.addEventListener('progress', () => {
                if (this.audio.buffered.length > 0) {
                    const progress = (this.audio.buffered.end(this.audio.buffered.length - 1) / this.audio.duration) * 100;
                    this.updateLoadingProgress(progress);
                }
            });

            this.audio.addEventListener('canplaythrough', async () => {
                this.hideLoading();
                this.updateLoadingProgress(100);

                // Only restore position if we haven't done so yet
                if (!this.positionRestored) {
                    const savedPosition = await this.getPlaybackPosition(file);
                    if (savedPosition) {
                        this.audio.currentTime = savedPosition;
                        console.log(`Restored playback position to ${savedPosition} seconds`);
                        this.positionRestored = true;
                    }
                }
            });

            this.audio.addEventListener('error', (e) => {
                console.error('Error loading audio:', e);
                this.hideLoading();
                alert('Error loading audio file');
            });

            // Wait for the audio to be loaded before connecting to analyzer
            await new Promise((resolve) => {
                this.audio.addEventListener('canplaythrough', resolve, { once: true });
            });

            // Create and connect new media source
            this.mediaSource = this.audioContext.createMediaElementSource(this.audio);
            this.mediaSource.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            
            // Parse filename for artist and title
            const fileName = file.name;
            const artistTitleMatch = fileName.match(/^(.+?)\s*-\s*(.+?)(?:\.[^.]+)?$/);
            
            if (artistTitleMatch) {
                const [, artist, title] = artistTitleMatch;
                this.trackTitle.textContent = title.trim();
                this.trackArtist.textContent = artist.trim();
            } else {
                this.trackTitle.textContent = fileName;
                this.trackArtist.textContent = '';
            }
            
            this.fileType.textContent = file.ext ? file.ext.toUpperCase() : 'Unknown';
            
            // Start playing immediately
            await this.audio.play();
            this.isPlaying = true;
            this.playBtn.querySelector('.control-icon').src = 'icons/pause.png';

            // Update next track display
            this.updateNextTrack();

            this.subtitles = null;
            this.subtitleCues = [];
            this.currentSubtitle = null;
            
            // Try to load associated VTT file
            if (file.subtitles) {
                try {
                    console.log('Attempting to load subtitles from:', file.subtitles);
                    const response = await fetch(file.subtitles);
                    const vttContent = await response.text();
                    console.log('VTT content loaded:', vttContent.substring(0, 200) + '...'); // Log first 200 chars
                    
                    this.subtitles = this.parseVTT(vttContent);
                    console.log('Parsed VTT cues:', this.subtitles.cues);
                    
                    this.subtitleCues = this.subtitles.cues;
                    this.isSubtitleEnabled = true;
                    document.getElementById('subtitle-btn').classList.add('active');
                    document.querySelector('.subtitle-container').classList.add('show');
                    
                    console.log('Subtitles loaded successfully. Number of cues:', this.subtitleCues.length);
                } catch (error) {
                    console.error('Error loading subtitles:', error);
                    this.subtitles = null;
                    this.subtitleCues = [];
                    this.isSubtitleEnabled = false;
                    document.getElementById('subtitle-btn').classList.remove('active');
                    document.querySelector('.subtitle-container').classList.remove('show');
                }
            } else {
                console.log('No subtitle file associated with this track');
                this.subtitles = null;
                this.subtitleCues = [];
                this.isSubtitleEnabled = false;
                document.getElementById('subtitle-btn').classList.remove('active');
                document.querySelector('.subtitle-container').classList.remove('show');
            }
        } catch (error) {
            console.error('Error loading track:', error);
            this.hideLoading();
            alert('Error loading audio file');
        }
    }

    drawVisualizer() {
        requestAnimationFrame(() => this.drawVisualizer());

        this.analyser.getByteFrequencyData(this.dataArray);

        // Apply smoothing to the frequency data
        for(let i = 0; i < this.bufferLength; i++) {
            this.dataArray[i] = this.previousDataArray[i] * this.visualizerSmoothing + 
                              this.dataArray[i] * (1 - this.visualizerSmoothing);
            this.previousDataArray[i] = this.dataArray[i];
        }

        this.canvasCtx.fillStyle = this.colors.background;
        this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const radius = Math.min(centerX, centerY) * 0.8;

        switch(this.visualizerStyle) {
            case 'bars':
                this.drawBars();
                break;
            case 'circle':
                this.drawCircle();
                break;
            case 'particles':
                this.drawParticles();
                break;
            case 'waveform':
                this.drawWaveform();
                break;
        }
    }

    drawBars() {
        const barWidth = (this.canvas.width / this.bufferLength) * 2.5;
        let x = 0;
        const maxHeight = this.canvas.height * 0.8 * this.visualizerReactivity;

        for(let i = 0; i < this.bufferLength; i++) {
            const barHeight = (this.dataArray[i] / 255) * maxHeight;
            const gradient = this.canvasCtx.createLinearGradient(0, this.canvas.height, 0, 0);
            gradient.addColorStop(0, this.visualizerColor);
            gradient.addColorStop(1, this.hexToRgb(this.visualizerColor, 0.3));
            
            this.canvasCtx.fillStyle = gradient;
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    drawCircle() {
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const radius = Math.min(centerX, centerY) * 0.4;

        // Draw base circle
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        this.canvasCtx.strokeStyle = this.hexToRgb(this.visualizerColor, 0.3);
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.stroke();

        // Calculate average amplitude for the outer circle
        let totalAmplitude = 0;
        for(let i = 0; i < this.bufferLength; i++) {
            totalAmplitude += this.dataArray[i];
        }
        const averageAmplitude = totalAmplitude / this.bufferLength;
        const pulseRadius = radius + (averageAmplitude / 255) * 80 * this.visualizerReactivity;

        // Draw reactive circle with gradient
        const gradient = this.canvasCtx.createRadialGradient(
            centerX, centerY, radius,
            centerX, centerY, pulseRadius
        );
        gradient.addColorStop(0, this.hexToRgb(this.visualizerColor, 0.8));
        gradient.addColorStop(1, this.hexToRgb(this.visualizerColor, 0.2));

        this.canvasCtx.beginPath();
        this.canvasCtx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
        this.canvasCtx.strokeStyle = gradient;
        this.canvasCtx.lineWidth = 4;
        this.canvasCtx.stroke();

        // Draw frequency lines with improved responsiveness
        for(let i = 0; i < this.bufferLength; i += 2) {
            const angle = (i * Math.PI * 2) / this.bufferLength;
            const amplitude = this.dataArray[i] / 255;
            const lineLength = amplitude * 100 * this.visualizerReactivity;
            
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(
                centerX + Math.cos(angle) * radius,
                centerY + Math.sin(angle) * radius
            );
            this.canvasCtx.lineTo(
                centerX + Math.cos(angle) * (radius + lineLength),
                centerY + Math.sin(angle) * (radius + lineLength)
            );
            this.canvasCtx.strokeStyle = this.hexToRgb(this.visualizerColor, amplitude * 0.8);
            this.canvasCtx.lineWidth = 2;
            this.canvasCtx.stroke();
        }
    }

    drawWaveform() {
        const bottomY = this.canvas.height;
        const lineHeight = this.canvas.height * 0.6 * this.visualizerReactivity;

        // Draw main waveform
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(0, bottomY);

        for(let i = 0; i < this.bufferLength; i++) {
            const x = (i / this.bufferLength) * this.canvas.width;
            const amplitude = (this.dataArray[i] / 255) * lineHeight;
            const y = bottomY - amplitude;
            
            if(i === 0) {
                this.canvasCtx.moveTo(x, y);
            } else {
                this.canvasCtx.lineTo(x, y);
            }
        }

        // Create gradient
        const gradient = this.canvasCtx.createLinearGradient(0, bottomY - lineHeight, 0, bottomY);
        gradient.addColorStop(0, this.hexToRgb(this.visualizerColor, 0.3));
        gradient.addColorStop(0.5, this.visualizerColor);
        gradient.addColorStop(1, this.hexToRgb(this.visualizerColor, 0.3));

        this.canvasCtx.strokeStyle = gradient;
        this.canvasCtx.lineWidth = 3;
        this.canvasCtx.stroke();

        // Fill the waveform
        this.canvasCtx.lineTo(this.canvas.width, bottomY);
        this.canvasCtx.lineTo(0, bottomY);
        this.canvasCtx.fillStyle = this.hexToRgb(this.visualizerColor, 0.1);
        this.canvasCtx.fill();
    }

    drawParticles() {
        // Update particles
        for(let i = 0; i < this.bufferLength; i++) {
            const amplitude = this.dataArray[i] / 255;
            if(amplitude > 0.3 && this.particles.length < 100) {
                this.particles.push({
                    x: Math.random() * this.canvas.width,
                    y: Math.random() * this.canvas.height,
                    size: Math.random() * 4 + 2,
                    speedX: (Math.random() - 0.5) * 4 * this.visualizerReactivity,
                    speedY: (Math.random() - 0.5) * 4 * this.visualizerReactivity,
                    life: 1
                });
            }
        }

        // Draw and update particles
        this.particles = this.particles.filter(particle => {
            particle.x += particle.speedX;
            particle.y += particle.speedY;
            particle.life -= 0.01;

            if(particle.life <= 0) return false;

            this.canvasCtx.beginPath();
            this.canvasCtx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.canvasCtx.fillStyle = this.hexToRgb(this.visualizerColor, particle.life);
            this.canvasCtx.fill();

            return true;
        });
    }

    hexToRgb(hex, alpha = 1) {
        // Handle invalid input
        if (!hex || typeof hex !== 'string') {
            console.warn('Invalid hex color provided to hexToRgb:', hex);
            return 'rgba(0, 0, 0, 1)'; // Return black as fallback
        }

        // Remove # if present
        hex = hex.replace('#', '');

        // Handle shorthand hex (e.g., #fff)
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }

        // Validate hex length
        if (hex.length !== 6) {
            console.warn('Invalid hex color length:', hex);
            return 'rgba(0, 0, 0, 1)'; // Return black as fallback
        }

        try {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            
            // Validate parsed values
            if (isNaN(r) || isNaN(g) || isNaN(b)) {
                throw new Error('Invalid hex color values');
            }

            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } catch (error) {
            console.warn('Error parsing hex color:', error);
            return 'rgba(0, 0, 0, 1)'; // Return black as fallback
        }
    }

    // Add a new function for getting RGB array
    hexToRgbArray(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16)
        ] : null;
    }

    async togglePlay() {
        if (this.isPlaying) {
            await this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (this.currentTrack) {
            this.audio.play().catch(error => {
                console.error('Error playing audio:', error);
            });
            this.isPlaying = true;
            this.playBtn.querySelector('.control-icon').src = 'icons/pause.png';
        }
    }

    async pause() {
        if (this.audio) {
            this.audio.pause();
            this.isPlaying = false;
            this.playBtn.querySelector('.control-icon').src = 'icons/play.png';
            // Save position when pausing
            try {
                await this.ensureDatabaseReady();
                await this.savePlaybackPosition(this.currentTrack, this.audio.currentTime);
            } catch (error) {
                console.error('Error saving playback position:', error);
            }
        }
    }

    playPrevious() {
        if (this.playlist.length === 0) return;
        
        // Stop current audio
        if (this.audio) {
            this.audio.pause();
            this.audio.currentTime = 0;
        }
        
        // Show loading state
        this.showLoading();
        this.updateLoadingProgress(0);
        
        let prevTrack;
        if (this.isShuffled) {
            // Get previous track from shuffled playlist
            this.shuffledPlaylist.unshift(this.shuffledPlaylist.pop());
            prevTrack = this.shuffledPlaylist[0];
            this.currentIndex = this.playlist.indexOf(prevTrack);
        } else {
            // If we're at the start of the playlist
            if (this.currentIndex <= 0) {
                if (this.isLooped) {
                    this.currentIndex = this.playlist.length - 1;
                } else {
                    return; // Stop if not looping
                }
            } else {
                this.currentIndex--;
            }
            prevTrack = this.playlist[this.currentIndex];
        }
        
        console.log('Playing previous track:', this.currentIndex);
        this.loadTrack(prevTrack);
        this.updateNextTrack();
    }

    playNext() {
        if (this.playlist.length === 0) return;
        
        // Stop current audio
        if (this.audio) {
            this.audio.pause();
            this.audio.currentTime = 0;
        }
        
        // Show loading state
        this.showLoading();
        this.updateLoadingProgress(0);
        
        let nextTrack;
        if (this.isShuffled) {
            // Get next track from shuffled playlist
            this.shuffledPlaylist.push(this.shuffledPlaylist.shift());
            nextTrack = this.shuffledPlaylist[0];
            this.currentIndex = this.playlist.indexOf(nextTrack);
        } else {
            // If we're at the end of the playlist
            if (this.currentIndex >= this.playlist.length - 1) {
                if (this.isLooped) {
                    this.currentIndex = 0;
                } else {
                    return; // Stop if not looping
                }
            } else {
                this.currentIndex++;
            }
            nextTrack = this.playlist[this.currentIndex];
        }
        
        console.log('Playing next track:', this.currentIndex);
        this.loadTrack(nextTrack);
        this.updateNextTrack();
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.audio.muted = this.isMuted;
        this.muteBtn.querySelector('.control-icon').src = this.isMuted ? 'icons/mute.png' : 'icons/volume.png';
    }

    setVolume(value) {
        this.volume = value;
        this.audio.volume = value;
        this.muteBtn.querySelector('.control-icon').src = value === 0 ? 'icons/mute.png' : 'icons/volume.png';
        // Update volume slider fill
        this.volumeSlider.style.setProperty('--volume-level', `${value * 100}%`);
    }

    seekTo(event) {
        const percent = event.offsetX / this.progressBar.offsetWidth;
        this.audio.currentTime = percent * this.audio.duration;
    }

    updateProgress() {
        if (!this.audio) return;
        
        const currentTime = this.audio.currentTime;
        const duration = this.audio.duration;
        const progress = (currentTime / duration) * 100;
        
        document.querySelector('.progress').style.width = `${progress}%`;
        document.querySelector('.current-time').textContent = this.formatTime(currentTime);
        
        // Update subtitles
        if (this.isSubtitleEnabled && this.subtitleCues && this.subtitleCues.length > 0) {
            const currentCue = this.subtitleCues.find(cue => 
                currentTime >= cue.start && currentTime <= cue.end
            );
            
            const subtitleText = document.querySelector('.subtitle-text');
            const subtitleContainer = document.querySelector('.subtitle-container');
            
            if (currentCue) {
                console.log('Current subtitle cue:', currentCue);
                // Remove speaker labels from the text
                const textWithoutSpeaker = currentCue.text.replace(/\[SPEAKER_\d+\]:\s*/g, '');
                subtitleText.textContent = textWithoutSpeaker;
                subtitleContainer.classList.add('show');
                console.log('Subtitle text set to:', textWithoutSpeaker);
            } else {
                subtitleText.textContent = '';
                subtitleContainer.classList.remove('show');
            }
        }
    }

    updateTotalTime() {
        this.totalTimeEl.textContent = this.formatTime(this.audio.duration);
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        seconds = Math.floor(seconds % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    toggleSettings() {
        this.settingsModal.classList.toggle('show');
    }

    updateColor(type, value) {
        this.colors[type] = value;
        
        switch(type) {
            case 'background':
                document.body.style.backgroundColor = value;
                document.querySelector('.audio-player').style.backgroundColor = value;
                break;
            case 'accent':
                document.documentElement.style.setProperty('--accent-color', value);
                break;
            case 'text':
                document.documentElement.style.setProperty('--text-color', value);
                break;
            case 'visualizerStart':
                this.visualizerStartColorPicker.value = value;
                break;
            case 'visualizerEnd':
                this.visualizerEndColorPicker.value = value;
                break;
        }
    }

    showLoading() {
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('show');
            this.loadingAnimation.play();
            this.floatingAnimation.play();
            this.updateSpiralColor();
        }
    }

    hideLoading() {
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.remove('show');
            this.loadingAnimation.pause();
            this.floatingAnimation.pause();
        }
    }

    updateLoadingProgress(progress) {
        if (this.loadingProgress) {
            this.loadingProgress.textContent = `${Math.round(progress)}%`;
        }
    }

    toggleShuffle() {
        this.isShuffled = !this.isShuffled;
        this.shuffleBtn.classList.toggle('active');
        
        if (this.isShuffled) {
            // Create a copy of the playlist and shuffle it
            this.shuffledPlaylist = [...this.playlist];
            this.shuffleArray(this.shuffledPlaylist);
            
            // Find the current track in the shuffled playlist
            const currentTrackIndex = this.shuffledPlaylist.findIndex(track => track === this.currentTrack);
            if (currentTrackIndex !== -1) {
                // Move current track to the start
                const [currentTrack] = this.shuffledPlaylist.splice(currentTrackIndex, 1);
                this.shuffledPlaylist.unshift(currentTrack);
            }
        }
        
        this.updateNextTrack();
    }

    toggleLoop() {
        this.isLooped = !this.isLooped;
        this.loopBtn.classList.toggle('active');
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    updateNextTrack() {
        if (!this.playlist.length) {
            this.nextTrackTitle.textContent = '';
            return;
        }

        let nextIndex;
        if (this.isShuffled) {
            nextIndex = 1; // Current track is at index 0 in shuffled playlist
        } else {
            nextIndex = (this.currentIndex + 1) % this.playlist.length;
        }

        const nextTrack = this.isShuffled ? this.shuffledPlaylist[nextIndex] : this.playlist[nextIndex];
        if (nextTrack) {
            const fileName = nextTrack.name;
            const artistTitleMatch = fileName.match(/^(.+?)\s*-\s*(.+?)(?:\.[^.]+)?$/);
            this.nextTrackTitle.textContent = artistTitleMatch ? artistTitleMatch[2].trim() : fileName;
            
            // Wait for the next frame to ensure the text has been rendered
            requestAnimationFrame(() => {
                const container = this.nextTrackTitle.parentElement;
                const titleWidth = this.nextTrackTitle.scrollWidth;
                const containerWidth = container.clientWidth;
                
                // Only enable scrolling if the text is significantly wider than the container
                const isOverflowing = titleWidth > containerWidth + 20; // 20px buffer
                
                // Remove any existing animation
                this.nextTrackTitle.style.animation = 'none';
                
                // Force a reflow
                void this.nextTrackTitle.offsetWidth;
                
                // Add the animation class only if overflowing
                container.classList.toggle('overflowing', isOverflowing);
                
                if (isOverflowing) {
                    // Start the scrolling animation
                    this.nextTrackTitle.style.animation = 'marquee 15s linear infinite';
                }
            });
        } else {
            this.nextTrackTitle.textContent = '';
        }
    }

    setRandomBackground() {
        if (!this.useCustomBackground) {
            document.body.style.backgroundImage = 'none';
            return;
        }
        
        if (this.backgroundImages.length > 0) {
            const randomIndex = Math.floor(Math.random() * this.backgroundImages.length);
            const randomImage = this.backgroundImages[randomIndex];
            
            // Create a new image to preload
            const img = new Image();
            img.onload = () => {
                // Set the background image only after it's loaded
                document.body.style.backgroundImage = `url(${randomImage})`;
                
                const maxWidth = 1500;
                const maxHeight = 1000;
                let width = img.width;
                let height = img.height;

                // Calculate aspect ratio
                const aspectRatio = width / height;

                // Adjust dimensions while maintaining aspect ratio
                if (width > maxWidth) {
                    width = maxWidth;
                    height = width / aspectRatio;
                }
                if (height > maxHeight) {
                    height = maxHeight;
                    width = height * aspectRatio;
                }

                // Round dimensions to whole numbers
                width = Math.round(width);
                height = Math.round(height);

                // Resize window
                window.resizeTo(width, height);
            };
            img.onerror = () => {
                console.error('Error loading background image');
                document.body.style.backgroundImage = 'none';
            };
            img.src = randomImage;
        } else {
            document.body.style.backgroundImage = 'none';
        }
    }

    setBackgroundBlur(blur) {
        this.backgroundBlur = blur;
        document.querySelector('.audio-player').style.backdropFilter = `blur(${blur}px)`;
        localStorage.setItem('backgroundBlur', blur);
    }

    async togglePin() {
        try {
            this.isPinned = !this.isPinned;
            this.pinBtn.classList.toggle('active');
            await this.setAlwaysOnTop(this.isPinned);
            localStorage.setItem('isPinned', this.isPinned);
        } catch (error) {
            console.error('Error toggling pin state:', error);
            // Revert the state if there's an error
            this.isPinned = !this.isPinned;
            this.pinBtn.classList.toggle('active');
            localStorage.setItem('isPinned', this.isPinned);
        }
    }

    async setAlwaysOnTop(onTop) {
        if (!window.eagle) return;
        
        try {
            // First set the always on top state
            await eagle.window.setAlwaysOnTop(onTop);
            
            // If we're setting to always on top, ensure the window is focused
            if (onTop) {
                // Wait a small delay to ensure the window state has been applied
                await new Promise(resolve => setTimeout(resolve, 100));
                await eagle.window.focus();
            }
        } catch (error) {
            console.error('Error setting window state:', error);
            // If there's an error, try to recover the state
            this.isPinned = !onTop;
            this.pinBtn.classList.toggle('active');
            localStorage.setItem('isPinned', this.isPinned);
        }
    }

    async getPlaybackPosition(file) {
        if (!this.db) {
            console.error('Database not initialized');
            return null;
        }

        return new Promise((resolve, reject) => {
            try {
            const transaction = this.db.transaction(['playbackPositions'], 'readonly');
            const store = transaction.objectStore('playbackPositions');
            const fileId = file.fileURL || file.name;
            const request = store.get(fileId);

            request.onsuccess = (event) => {
                const result = event.target.result;
                if (result) {
                    // Update listening history display
                    this.updateListeningHistory(result);
                }
                resolve(result ? result.position : null);
            };

                request.onerror = (event) => {
                    console.error('Error getting playback position:', event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                console.error('Error in getPlaybackPosition:', error);
                reject(error);
            }
        });
    }

    async savePlaybackPosition(file, position) {
        if (!this.db) {
            console.error('Database not initialized');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
            const transaction = this.db.transaction(['playbackPositions'], 'readwrite');
            const store = transaction.objectStore('playbackPositions');
            const fileId = file.fileURL || file.name;
            
                const data = {
                fileId: fileId,
                position: position,
                timestamp: Date.now()
                };

                const request = store.put(data);

                request.onsuccess = () => {
                    console.log('Playback position saved successfully');
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('Error saving playback position:', event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                console.error('Error in savePlaybackPosition:', error);
                reject(error);
            }
        });
    }

    updateListeningHistory(history) {
        if (!history) {
            this.listeningHistory.classList.remove('show');
            return;
        }

        // Format the timestamp
        const lastListened = new Date(history.timestamp);
        const now = new Date();
        const diff = now - lastListened;
        
        let timeAgo;
        if (diff < 60000) { // Less than 1 minute
            timeAgo = 'Just now';
        } else if (diff < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diff / 60000);
            timeAgo = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (diff < 86400000) { // Less than 1 day
            const hours = Math.floor(diff / 3600000);
            timeAgo = `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else if (diff < 604800000) { // Less than 1 week
            const days = Math.floor(diff / 86400000);
            timeAgo = `${days} day${days > 1 ? 's' : ''} ago`;
        } else {
            timeAgo = lastListened.toLocaleDateString();
        }

        // Format the position
        const position = this.formatTime(history.position);
        const duration = this.audio ? this.formatTime(this.audio.duration) : '';

        // Update the display
        this.lastListened.textContent = `Last listened: ${timeAgo}`;
        this.lastPosition.textContent = `Stopped at: ${position}${duration ? ` of ${duration}` : ''}`;
        this.listeningHistory.classList.add('show');
    }

    parseVTT(vttContent) {
        console.log('Parsing VTT content...');
        const lines = vttContent.split('\n');
        const cues = [];
        let currentCue = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line === 'WEBVTT') {
                console.log('Found WEBVTT header');
                continue;
            }
            if (line === '') continue;
            
            if (line.includes('-->')) {
                const [start, end] = line.split('-->').map(time => this.parseVTTTime(time.trim()));
                currentCue = { start, end, text: '' };
                cues.push(currentCue);
                console.log('Found cue:', { start, end });
            } else if (currentCue) {
                currentCue.text += (currentCue.text ? '\n' : '') + line;
            }
        }

        console.log('Parsed cues:', cues);
        return { cues };
    }

    parseVTTTime(timeStr) {
        // VTT time format: HH:MM:SS.mmm
        const parts = timeStr.trim().split(':');
        let seconds = 0;
        
        if (parts.length === 3) {
            // HH:MM:SS.mmm format
            seconds = parseInt(parts[0]) * 3600 + // hours
                     parseInt(parts[1]) * 60 +    // minutes
                     parseFloat(parts[2]);        // seconds with milliseconds
        } else if (parts.length === 2) {
            // MM:SS.mmm format
            seconds = parseInt(parts[0]) * 60 +   // minutes
                     parseFloat(parts[1]);        // seconds with milliseconds
        }
        
        return seconds;
    }

    toggleSubtitles() {
        this.isSubtitleEnabled = !this.isSubtitleEnabled;
        const subtitleBtn = document.getElementById('subtitle-btn');
        const subtitleContainer = document.querySelector('.subtitle-container');
        const subtitleText = document.querySelector('.subtitle-text');
        
        if (this.isSubtitleEnabled) {
            subtitleBtn.classList.add('active');
            subtitleContainer.classList.add('show');
            subtitleText.style.display = 'block';
            // Update settings toggle to match
            const subtitleToggle = document.getElementById('subtitle-toggle');
            if (subtitleToggle) {
                subtitleToggle.checked = true;
            }
        } else {
            subtitleBtn.classList.remove('active');
            subtitleContainer.classList.remove('show');
            subtitleText.style.display = 'none';
            subtitleText.textContent = '';
            // Update settings toggle to match
            const subtitleToggle = document.getElementById('subtitle-toggle');
            if (subtitleToggle) {
                subtitleToggle.checked = false;
            }
        }
    }

    async setTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        // Update colors object for visualizer
        const computedStyle = getComputedStyle(document.documentElement);
        this.colors.background = computedStyle.getPropertyValue('--theme-background').trim();
        this.colors.accent = computedStyle.getPropertyValue('--theme-accent').trim();
        this.colors.text = computedStyle.getPropertyValue('--theme-text').trim();
        this.colors.visualizerStart = computedStyle.getPropertyValue('--theme-accent').trim();
        this.colors.visualizerEnd = computedStyle.getPropertyValue('--theme-progress-fill').trim();
        
        // Update visualizer color to match theme
        this.visualizerColor = this.colors.accent;
        if (this.visualizerColorInput) {
            this.visualizerColorInput.value = this.visualizerColor;
        }
        localStorage.setItem('visualizerColor', this.visualizerColor);

        // Update subtitle icon to match theme
        const subtitleBtn = document.getElementById('subtitle-btn');
        if (subtitleBtn) {
            const icon = subtitleBtn.querySelector('.control-icon');
            if (icon) {
                icon.src = `icons/${theme}/transcription.png`;
            }
        }
        
        // If custom backgrounds are enabled and we have background images, find and apply a new matching image
        if (this.useCustomBackground && this.backgroundImages.length > 0) {
            try {
                // Use pre-computed colors for faster matching
                const matchingImage = await this.findMatchingImages(this.backgroundImages);
                if (matchingImage) {
                    this.backgroundImage = matchingImage;
                    this.currentBackgroundIndex = this.backgroundImages.indexOf(matchingImage);
                    this.applyBackground(this.backgroundImage);
                }
            } catch (error) {
                console.error('Error updating background image for new theme:', error);
            }
        } else {
            document.body.style.backgroundImage = 'none';
        }
        
        // Update spiral color if overlay exists
        this.updateSpiralColor();
    }

    updateBackgroundOptions() {
        console.log('Updating background options:', {
            useCustomBackground: this.useCustomBackground,
            hasBackgroundImage: !!this.backgroundImage
        });
        
        if (!this.backgroundOptions) return;

            if (this.useCustomBackground) {
            this.backgroundOptions.style.display = 'block';
            if (this.removeBackgroundBtn) {
                this.removeBackgroundBtn.style.display = this.backgroundImage ? 'block' : 'none';
            }
            } else {
            this.backgroundOptions.style.display = 'none';
            this.removeBackground();
            }
    }

    updateSpiralColor() {
        if (!this.loadingOverlay) return;
        // Always read the accent color from the CSS variable
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim() || '#39ff14';
        const svg = this.loadingOverlay.querySelector('svg');
        if (!svg) return;
        const gradient = svg.querySelector('linearGradient');
        if (!gradient) return;
        const stops = gradient.querySelectorAll('stop');
        if (stops.length === 4) {
            stops[0].setAttribute('stop-color', accentColor);
            stops[1].setAttribute('stop-color', accentColor);
            stops[2].setAttribute('stop-color', accentColor);
            stops[3].setAttribute('stop-color', accentColor);
        }
    }

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                console.log('Background image loaded successfully');
                resolve(e.target.result);
            };
            reader.onerror = (e) => {
                console.error('Error reading background image file:', e);
                reject(e);
            };
            reader.readAsDataURL(file);
        });
    }

    applyBackground(imageUrl) {
        console.log('Applying background:', imageUrl);
        if (!this.useCustomBackground) {
            console.log('Custom background is disabled');
            return;
        }
        
        // Create a new image to preload
        const img = new Image();
        img.onload = () => {
            console.log('Background image loaded and ready to apply');
            
            // Calculate window size based on image aspect ratio
            const maxWidth = 1000;  // Reduced from 1200
            const maxHeight = 700;  // Reduced from 800
            const aspectRatio = img.width / img.height;
            
            let windowWidth, windowHeight;
            
            // Calculate dimensions while maintaining aspect ratio
            if (aspectRatio > 1) {
                // Landscape image - prioritize width
                windowWidth = Math.min(maxWidth, img.width);
                windowHeight = Math.round(windowWidth / aspectRatio);
                
                // If height is too small, adjust based on height instead
                if (windowHeight < 500) {  // Reduced from 600
                    windowHeight = 500;
                    windowWidth = Math.round(windowHeight * aspectRatio);
                }
            } else {
                // Portrait image - prioritize height
                windowHeight = Math.min(maxHeight, img.height);
                windowWidth = Math.round(windowHeight * aspectRatio);
                
                // If width is too small, adjust based on width instead
                if (windowWidth < 700) {  // Reduced from 800
                    windowWidth = 700;
                    windowHeight = Math.round(windowWidth / aspectRatio);
                }
            }
            
            // Add padding for the player UI
            windowWidth += 40;  // 20px padding on each side
            windowHeight += 40; // 20px padding on top and bottom
            
            // Resize window
            window.resizeTo(windowWidth, windowHeight);
            
            // Apply the background image to the body
            document.body.style.backgroundImage = `url(${imageUrl})`;
            document.body.style.backgroundColor = 'transparent';
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundRepeat = 'no-repeat';
            document.body.style.backgroundAttachment = 'fixed';
            
            // Get theme colors
            const computedStyle = getComputedStyle(document.documentElement);
            const themeBackground = computedStyle.getPropertyValue('--theme-background').trim();
            const themeBackgroundRGB = this.hexToRgbArray(themeBackground);
            
            // Ensure audio player has semi-transparent background using theme color
            if (this.audioPlayer) {
                this.audioPlayer.style.backgroundColor = `rgba(${themeBackgroundRGB[0]}, ${themeBackgroundRGB[1]}, ${themeBackgroundRGB[2]}, ${this.backgroundOpacity})`;
            }
            
            // Adjust the overlay opacity with theme color
            const style = document.createElement('style');
            style.textContent = `
                body::before {
                    background-color: ${themeBackground} !important;
                    opacity: 0.3 !important;
                }
                .audio-player {
                    background-color: rgba(${themeBackgroundRGB[0]}, ${themeBackgroundRGB[1]}, ${themeBackgroundRGB[2]}, ${this.backgroundOpacity}) !important;
                }
            `;
            document.head.appendChild(style);
            
            this.updateBackgroundBlur();
        };
        img.onerror = (error) => {
            console.error('Error loading background image:', error);
            this.removeBackground();
        };
        img.src = imageUrl;
    }

    updateBackgroundBlur() {
        console.log('Updating background blur:', this.backgroundBlur);
        if (!this.useCustomBackground) {
            console.log('Custom background is disabled');
            return;
        }
        if (this.audioPlayer) {
            const blurValue = `${this.backgroundBlur}px`;
            this.audioPlayer.style.backdropFilter = `blur(${blurValue})`;
            this.audioPlayer.style.webkitBackdropFilter = `blur(${blurValue})`;
        }
    }

    updateBackgroundOpacity() {
        if (!this.useCustomBackground) {
            console.log('Custom background is disabled');
            return;
        }
        if (this.audioPlayer) {
            // Get theme colors
            const computedStyle = getComputedStyle(document.documentElement);
            const themeBackground = computedStyle.getPropertyValue('--theme-background').trim();
            const themeBackgroundRGB = this.hexToRgbArray(themeBackground);
            
            this.audioPlayer.style.backgroundColor = `rgba(${themeBackgroundRGB[0]}, ${themeBackgroundRGB[1]}, ${themeBackgroundRGB[2]}, ${this.backgroundOpacity})`;
            // Update the overlay opacity as well
            const style = document.createElement('style');
            style.textContent = `
                body::before {
                    background-color: ${themeBackground} !important;
                    opacity: 0.3 !important;
                }
                .audio-player {
                    background-color: rgba(${themeBackgroundRGB[0]}, ${themeBackgroundRGB[1]}, ${themeBackgroundRGB[2]}, ${this.backgroundOpacity}) !important;
                }
            `;
            document.head.appendChild(style);
        }
    }

    async removeBackground() {
        console.log('Removing background');
        document.body.style.backgroundImage = 'none';
        
        // Get theme colors
        const computedStyle = getComputedStyle(document.documentElement);
        const themeBackground = computedStyle.getPropertyValue('--theme-background').trim();
        
        document.body.style.backgroundColor = themeBackground;
        
        // Reset the overlay opacity with theme color
        const style = document.createElement('style');
        style.textContent = `
            body::before {
                background-color: ${themeBackground} !important;
                opacity: 0.7 !important;
            }
            .audio-player {
                background-color: ${themeBackground} !important;
            }
        `;
        document.head.appendChild(style);
        
        if (this.audioPlayer) {
            this.audioPlayer.style.backdropFilter = 'none';
            this.audioPlayer.style.webkitBackdropFilter = 'none';
        }

        // Clear background images from IndexedDB
        try {
            await this.removeBackgroundImages();
            this.backgroundImage = null;
            this.backgroundImages = [];
            this.backgroundImageColors = [];
            this.themeBestMatches = {};
            localStorage.removeItem('backgroundImage');
            localStorage.removeItem('themeBestMatches');
            
            // Hide reset button
            if (this.resetBackgroundBtn) {
                this.resetBackgroundBtn.style.display = 'none';
            }
        } catch (error) {
            console.error('Error removing background images:', error);
        }
        
        if (this.removeBackgroundBtn) {
            this.removeBackgroundBtn.style.display = 'none';
        }
    }

    // Add resizeCanvas method
    resizeCanvas() {
        if (!this.canvas) return;
        
        // Get the parent container's dimensions
        const container = this.canvas.parentElement;
        if (!container) return;
        
        // Set canvas size to match container
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        // Clear the canvas
        if (this.canvasCtx) {
            this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    async analyzeImageColors(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Resize image for faster processing while maintaining quality
                const maxSize = 200; // Increased for better accuracy
                const scale = Math.min(maxSize / img.width, maxSize / img.height);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const colors = [];
                const colorCounts = new Map();
                
                // Sample pixels and count color frequencies
                for (let i = 0; i < imageData.length; i += 4) {
                    const r = imageData[i];
                    const g = imageData[i + 1];
                    const b = imageData[i + 2];
                    const key = `${r},${g},${b}`;
                    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
                }
                
                // Get top 5 most frequent colors
                const sortedColors = Array.from(colorCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([color]) => color.split(',').map(Number));
                
                // Calculate weighted average of top colors
                const totalWeight = sortedColors.length;
                const avgColor = sortedColors.reduce((acc, color, index) => {
                    const weight = (totalWeight - index) / totalWeight;
                    return [
                        acc[0] + color[0] * weight,
                        acc[1] + color[1] * weight,
                        acc[2] + color[2] * weight
                    ];
                }, [0, 0, 0]).map(val => val / totalWeight);
                
                resolve(avgColor);
            };
            img.onerror = reject;
            img.src = imageUrl;
        });
    }

    getThemeColors() {
        const style = getComputedStyle(document.documentElement);
        return {
            background: this.hexToRgbArray(style.getPropertyValue('--theme-background').trim()),
            accent: this.hexToRgbArray(style.getPropertyValue('--theme-accent').trim()),
            text: this.hexToRgbArray(style.getPropertyValue('--theme-text').trim())
        };
    }

    colorDistance(color1, color2) {
        // Convert RGB to Lab color space for better color matching
        const lab1 = this.rgbToLab(color1);
        const lab2 = this.rgbToLab(color2);
        
        // Calculate CIE76 color difference with adjusted weights
        return Math.sqrt(
            Math.pow(lab1[0] - lab2[0], 2) * 1.2 + // Luminance weight
            Math.pow(lab1[1] - lab2[1], 2) * 1.0 + // a* weight
            Math.pow(lab1[2] - lab2[2], 2) * 1.0   // b* weight
        );
    }

    rgbToLab(rgb) {
        // Convert RGB to XYZ
        let r = rgb[0] / 255;
        let g = rgb[1] / 255;
        let b = rgb[2] / 255;

        // Apply gamma correction
        r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
        g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
        b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

        // Convert to XYZ
        r *= 100;
        g *= 100;
        b *= 100;

        const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
        const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const z = r * 0.0193 + g * 0.1192 + b * 0.9505;

        // Convert XYZ to Lab
        const xn = 95.047;
        const yn = 100.000;
        const zn = 108.883;

        const xr = x / xn;
        const yr = y / yn;
        const zr = z / zn;

        const fx = xr > 0.008856 ? Math.pow(xr, 1/3) : (7.787 * xr) + 16/116;
        const fy = yr > 0.008856 ? Math.pow(yr, 1/3) : (7.787 * yr) + 16/116;
        const fz = zr > 0.008856 ? Math.pow(zr, 1/3) : (7.787 * zr) + 16/116;

        return [
            (116 * fy) - 16,  // L
            500 * (fx - fy),  // a
            200 * (fy - fz)   // b
        ];
    }

    async findMatchingImages(images) {
        const themeColors = this.getThemeColors();
        
        // If we have pre-computed colors, use them
        if (this.backgroundImageColors.length === images.length) {
            // Score all images for this theme
            const scoredImages = images.map((url, index) => {
                const colors = this.backgroundImageColors[index];
                const backgroundDistance = this.colorDistance(colors, themeColors.background);
                const accentDistance = this.colorDistance(colors, themeColors.accent);
                const textDistance = this.colorDistance(colors, themeColors.text);
                
                // Calculate hue similarity for accent color
                const accentHueSimilarity = this.getHueSimilarity(colors, themeColors.accent);
                
                // Adjusted weights to be less strict
                const score = (backgroundDistance * 0.3) + 
                            (accentDistance * 0.3) + 
                            (textDistance * 0.2) + 
                            ((1 - accentHueSimilarity) * 0.2);
                
                return { index, score, accentHueSimilarity };
            });

            // Lower the hue similarity threshold to 0.5 (was 0.7)
            const filteredImages = scoredImages.filter(img => img.accentHueSimilarity > 0.5);
            
            if (filteredImages.length === 0) {
                // If no good matches, use the original scores but be less strict
                scoredImages.sort((a, b) => a.score - b.score);
                const topImages = scoredImages.slice(0, Math.ceil(scoredImages.length * 0.3)); // Increased from 0.2 to 0.3
                const randomMatch = topImages[Math.floor(Math.random() * topImages.length)];
                return images[randomMatch.index];
            }

            // Sort by score (lower is better)
            filteredImages.sort((a, b) => a.score - b.score);
            
            // Take top 30% of matches (increased from 20%)
            const topImages = filteredImages.slice(0, Math.ceil(filteredImages.length * 0.3));
            
            // Randomly select from top matches
            const randomMatch = topImages[Math.floor(Math.random() * topImages.length)];
            
            // Store this match in themeBestMatches for future reference
            if (!this.themeBestMatches[this.currentTheme]) {
                this.themeBestMatches[this.currentTheme] = [];
            }
            
            // Only add if not already in the list
            if (!this.themeBestMatches[this.currentTheme].includes(randomMatch.index)) {
                this.themeBestMatches[this.currentTheme].push(randomMatch.index);
                // Keep only the last 5 matches per theme
                if (this.themeBestMatches[this.currentTheme].length > 5) {
                    this.themeBestMatches[this.currentTheme].shift();
                }
                localStorage.setItem('themeBestMatches', JSON.stringify(this.themeBestMatches));
            }
            
            return images[randomMatch.index];
        }
        
        // Fallback to computing colors if not pre-computed
        const imageColors = await Promise.all(
            images.map(async (imageUrl, index) => ({
                index,
                colors: await this.analyzeImageColors(imageUrl)
            }))
        );

        // Store the computed colors
        this.backgroundImageColors = imageColors.map(img => img.colors);

        const scoredImages = imageColors.map(({ index, colors }) => {
            const backgroundDistance = this.colorDistance(colors, themeColors.background);
            const accentDistance = this.colorDistance(colors, themeColors.accent);
            const textDistance = this.colorDistance(colors, themeColors.text);
            
            // Calculate hue similarity for accent color
            const accentHueSimilarity = this.getHueSimilarity(colors, themeColors.accent);
            
            // Adjusted weights to be less strict
            const score = (backgroundDistance * 0.3) + 
                         (accentDistance * 0.3) + 
                         (textDistance * 0.2) + 
                         ((1 - accentHueSimilarity) * 0.2);
            
            return { index, score, accentHueSimilarity };
        });

        // Lower the hue similarity threshold to 0.5 (was 0.7)
        const filteredImages = scoredImages.filter(img => img.accentHueSimilarity > 0.5);
        
        if (filteredImages.length === 0) {
            // If no good matches, use the original scores but be less strict
            scoredImages.sort((a, b) => a.score - b.score);
            const topImages = scoredImages.slice(0, Math.ceil(scoredImages.length * 0.3)); // Increased from 0.2 to 0.3
            const randomMatch = topImages[Math.floor(Math.random() * topImages.length)];
            return images[randomMatch.index];
        }

        // Sort by score (lower is better)
        filteredImages.sort((a, b) => a.score - b.score);
        
        // Take top 30% of matches (increased from 20%)
        const topImages = filteredImages.slice(0, Math.ceil(filteredImages.length * 0.3));
        const randomMatch = topImages[Math.floor(Math.random() * topImages.length)];
        
        // Store this match in themeBestMatches
        if (!this.themeBestMatches[this.currentTheme]) {
            this.themeBestMatches[this.currentTheme] = [];
        }
        
        // Only add if not already in the list
        if (!this.themeBestMatches[this.currentTheme].includes(randomMatch.index)) {
            this.themeBestMatches[this.currentTheme].push(randomMatch.index);
            // Keep only the last 5 matches per theme
            if (this.themeBestMatches[this.currentTheme].length > 5) {
                this.themeBestMatches[this.currentTheme].shift();
            }
            localStorage.setItem('themeBestMatches', JSON.stringify(this.themeBestMatches));
        }
        
        return images[randomMatch.index];
    }

    getHueSimilarity(color1, color2) {
        // Convert RGB to HSL
        const hsl1 = this.rgbToHsl(color1);
        const hsl2 = this.rgbToHsl(color2);
        
        // Calculate hue difference (0-360 degrees)
        let hueDiff = Math.abs(hsl1[0] - hsl2[0]);
        if (hueDiff > 180) {
            hueDiff = 360 - hueDiff;
        }
        
        // Convert to similarity score (0-1)
        return 1 - (hueDiff / 180);
    }

    rgbToHsl(rgb) {
        const r = rgb[0] / 255;
        const g = rgb[1] / 255;
        const b = rgb[2] / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            
            h /= 6;
        }

        return [h * 360, s * 100, l * 100];
    }

    // Add method to load saved background images on startup
    async loadSavedBackgroundImages() {
        try {
            const savedImages = await this.loadBackgroundImages();
            if (savedImages.length > 0) {
                this.backgroundImages = savedImages;
                if (this.useCustomBackground) {
                    // Find and apply a matching image for current theme
                    const matchingImage = await this.findMatchingImages(this.backgroundImages);
                    if (matchingImage) {
                        this.backgroundImage = matchingImage;
                        this.currentBackgroundIndex = this.backgroundImages.indexOf(matchingImage);
                        this.applyBackground(this.backgroundImage);
                    }
                }
                // Show reset button if we have background images
                if (this.resetBackgroundBtn) {
                    this.resetBackgroundBtn.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Error loading saved background images:', error);
        }
    }

    // Add method to check if database is ready
    async ensureDatabaseReady() {
        if (!this.db) {
            try {
                await this.initIndexedDB();
            } catch (error) {
                console.error('Failed to initialize database:', error);
                throw error;
            }
        }
    }

    updateSubtitleStyles() {
        const root = document.documentElement;
        root.style.setProperty('--subtitle-size', `${this.subtitleSize}px`);
        root.style.setProperty('--subtitle-color', this.subtitleColor);
    }

    hexToRgb(hex, alpha = 1) {
        // Handle invalid input
        if (!hex || typeof hex !== 'string') {
            console.warn('Invalid hex color provided to hexToRgb:', hex);
            return 'rgba(0, 0, 0, 1)'; // Return black as fallback
        }

        // Remove # if present
        hex = hex.replace('#', '');

        // Handle shorthand hex (e.g., #fff)
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }

        // Validate hex length
        if (hex.length !== 6) {
            console.warn('Invalid hex color length:', hex);
            return 'rgba(0, 0, 0, 1)'; // Return black as fallback
        }

        try {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            
            // Validate parsed values
            if (isNaN(r) || isNaN(g) || isNaN(b)) {
                throw new Error('Invalid hex color values');
            }

            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } catch (error) {
            console.warn('Error parsing hex color:', error);
            return 'rgba(0, 0, 0, 1)'; // Return black as fallback
        }
    }
} 
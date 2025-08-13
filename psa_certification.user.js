// ==UserScript==
// @name         PSA Certification Lookup
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  Extracts PSA certification numbers from eBay listings and displays PSA price data
// @author       You
// @match        https://www.ebay.com/itm/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      www.psacard.com
// ==/UserScript==

(function() {
    'use strict';
    
    // Cache configuration
    const CACHE_CONFIG = {
        // Cache expiration time in milliseconds (default: 7 days)
        expirationTime: 7 * 24 * 60 * 60 * 1000,
        
        // Maximum number of items to keep in cache
        maxItems: 100,
        
        // Cache key prefix
        keyPrefix: 'psa_cert_data_'
    };
    
    // Cache management functions
    const CacheManager = {
        /**
         * Get data from cache
         * @param {string} certNumber - PSA certification number
         * @returns {object|null} Cached data or null if not found/expired
         */
        getData: function(certNumber) {
            try {
                const key = CACHE_CONFIG.keyPrefix + certNumber;
                const cachedData = GM_getValue(key);
                
                if (!cachedData) return null;
                
                // Check if data is expired
                if (Date.now() > cachedData.expiration) {
                    console.log('Cache expired for cert:', certNumber);
                    this.removeData(certNumber);
                    return null;
                }
                
                console.log('Cache hit for cert:', certNumber);
                
                // Mark the data as coming from cache
                const data = cachedData.data;
                data._fromCache = true;
                data._cacheTimestamp = cachedData.timestamp;
                data._cacheExpiration = cachedData.expiration;
                
                return data;
            } catch (e) {
                console.error('Error reading from cache:', e);
                return null;
            }
        },
        
        /**
         * Save data to cache
         * @param {string} certNumber - PSA certification number
         * @param {object} data - Data to cache
         */
        saveData: function(certNumber, data) {
            try {
                const key = CACHE_CONFIG.keyPrefix + certNumber;
                const cacheEntry = {
                    data: data,
                    timestamp: Date.now(),
                    expiration: Date.now() + CACHE_CONFIG.expirationTime
                };
                
                GM_setValue(key, cacheEntry);
                console.log('Saved to cache:', certNumber);
                
                // Check if we need to clean up old entries
                this.cleanupCache();
            } catch (e) {
                console.error('Error saving to cache:', e);
            }
        },
        
        /**
         * Remove data from cache
         * @param {string} certNumber - PSA certification number
         */
        removeData: function(certNumber) {
            try {
                const key = CACHE_CONFIG.keyPrefix + certNumber;
                GM_deleteValue(key);
                console.log('Removed from cache:', certNumber);
            } catch (e) {
                console.error('Error removing from cache:', e);
            }
        },
        
        /**
         * Clean up old cache entries if we exceed the maximum
         */
        cleanupCache: function() {
            try {
                const allKeys = GM_listValues();
                const psaKeys = allKeys.filter(key => key.startsWith(CACHE_CONFIG.keyPrefix));
                
                // If we're under the limit, no need to clean up
                if (psaKeys.length <= CACHE_CONFIG.maxItems) return;
                
                console.log('Cache cleanup needed. Current items:', psaKeys.length);
                
                // Get all cache entries with their timestamps
                const entries = psaKeys.map(key => {
                    const value = GM_getValue(key);
                    return {
                        key: key,
                        timestamp: value.timestamp || 0
                    };
                });
                
                // Sort by timestamp (oldest first)
                entries.sort((a, b) => a.timestamp - b.timestamp);
                
                // Delete oldest entries until we're under the limit
                const entriesToDelete = entries.slice(0, entries.length - CACHE_CONFIG.maxItems);
                entriesToDelete.forEach(entry => {
                    GM_deleteValue(entry.key);
                    console.log('Cache cleanup: removed', entry.key);
                });
                
                console.log('Cache cleanup complete. Removed', entriesToDelete.length, 'items');
            } catch (e) {
                console.error('Error during cache cleanup:', e);
            }
        },
        
        /**
         * Clear all cached data
         */
        clearAllData: function() {
            try {
                const allKeys = GM_listValues();
                const psaKeys = allKeys.filter(key => key.startsWith(CACHE_CONFIG.keyPrefix));
                
                psaKeys.forEach(key => {
                    GM_deleteValue(key);
                });
                
                console.log('Cleared all cache data. Removed', psaKeys.length, 'items');
            } catch (e) {
                console.error('Error clearing cache:', e);
            }
        }
    };

    // Wait for the page to fully load
    window.addEventListener('load', function() {
        // Wait a bit longer to ensure all eBay scripts have initialized
        setTimeout(initScript, 2000);
    });

    function initScript() {
        console.log('PSA Certification Lookup script initialized');
        
        // Check if this is a PSA graded item
        const isPsaItem = checkIfPsaItem();
        
        if (!isPsaItem) {
            console.log('This does not appear to be a PSA graded item');
            return;
        }
        
        // Find PSA certification number
        const psaCertNumber = extractPSACertNumber();
        
        if (psaCertNumber) {
            console.log('Found PSA certification number:', psaCertNumber);
            fetchPSAData(psaCertNumber);
        } else {
            console.log('No PSA certification number found on this page');
        }
    }
    
    function checkIfPsaItem() {
        // Check for PSA indicators in the page
        
        // Check for "Check PSA data" or "See all" button
        const psaDataButton = document.querySelector('button[data-clientpresentationmetadata*="CARD_INSIGHTS_PSA"]') || 
                              document.querySelector('button.fake-link[data-vi-tracking*="CLICK"]');
        if (psaDataButton) return true;
        
        // Check for PSA text in spans
        const spans = document.querySelectorAll('.ux-textspans, span');
        for (const span of spans) {
            if (span.textContent.includes('PSA') || 
                span.textContent.includes('Graded - PSA') || 
                span.textContent.includes('Check PSA data')) {
                return true;
            }
        }
        
        // Check for PSA in item specifics
        const itemSpecifics = document.querySelector('.ux-layout-section-evo--features');
        if (itemSpecifics && itemSpecifics.textContent.includes('PSA')) {
            return true;
        }
        
        // Check title for PSA
        const title = document.querySelector('.x-item-title__mainTitle');
        if (title && title.textContent.includes('PSA')) {
            return true;
        }
        
        return false;
    }

    // Helper function to validate if a number is likely a PSA certification number
    function isLikelyPSACertNumber(number) {
        // PSA cert numbers are typically 8-10 digits
        if (!number || typeof number !== 'string') return false;
        
        // Check length - PSA cert numbers are typically 8-10 digits
        // eBay item numbers are typically 12 digits
        if (number.length < 8 || number.length > 10) return false;
        
        // Check if it's all digits
        if (!/^\d+$/.test(number)) return false;
        
        // Avoid common eBay item ID patterns
        // eBay item IDs often start with specific digits like 1, 2, 3, or 4
        // and are typically 12 digits long
        if (number.length === 12 && /^[1-4]\d{11}$/.test(number)) return false;
        
        return true;
    }
    
    function extractPSACertNumber() {
        // Method -1: Check if there's a "Check PSA data" or "See all" link and try to click it first
        // Find elements containing "Check PSA data" text without using :contains selector
        let checkPsaDataLink = null;
        
        // First try to find by data attribute which is more reliable
        checkPsaDataLink = document.querySelector('button[data-clientpresentationmetadata*="CARD_INSIGHTS_PSA"]');
        
        // If not found, look for the new "See all" button with fake-link class that's specifically for PSA data
        if (!checkPsaDataLink) {
            // Look for all fake-link buttons
            const fakeLinks = document.querySelectorAll('button.fake-link[data-vi-tracking*="CLICK"]');
            
            // Find the one that's related to PSA certification
            for (const link of fakeLinks) {
                // Check if this button or its parent container has PSA-related text
                const buttonText = link.textContent.toLowerCase();
                const parentText = link.parentElement ? link.parentElement.textContent.toLowerCase() : '';
                const grandparentText = link.parentElement && link.parentElement.parentElement ? 
                                        link.parentElement.parentElement.textContent.toLowerCase() : '';
                
                if (buttonText.includes('psa') || 
                    buttonText.includes('cert') || 
                    buttonText.includes('grade') || 
                    parentText.includes('psa') || 
                    parentText.includes('cert') || 
                    parentText.includes('grade') || 
                    grandparentText.includes('psa') || 
                    grandparentText.includes('cert') || 
                    grandparentText.includes('grade')) {
                    
                    checkPsaDataLink = link;
                    console.log('Found PSA-related fake-link button:', buttonText);
                    break;
                }
                
                // If the button says "See all" and is near PSA text, it's likely the right one
                if (buttonText.includes('see all')) {
                    // Check if there's PSA text nearby
                    const nearbyElements = getNearbyElements(link, 3);
                    for (const elem of nearbyElements) {
                        const elemText = elem.textContent.toLowerCase();
                        if (elemText.includes('psa') || elemText.includes('cert') || elemText.includes('grade')) {
                            checkPsaDataLink = link;
                            console.log('Found "See all" button near PSA text');
                            break;
                        }
                    }
                    if (checkPsaDataLink) break;
                }
            }
        }
        
        // Helper function to get nearby elements
        function getNearbyElements(element, depth) {
            const result = [];
            
            // Add siblings
            let sibling = element.previousElementSibling;
            while (sibling) {
                result.push(sibling);
                sibling = sibling.previousElementSibling;
            }
            
            sibling = element.nextElementSibling;
            while (sibling) {
                result.push(sibling);
                sibling = sibling.nextElementSibling;
            }
            
            // Add parent and its siblings if depth allows
            if (depth > 0 && element.parentElement) {
                result.push(element.parentElement);
                result.push(...getNearbyElements(element.parentElement, depth - 1));
            }
            
            return result;
        }
        
        // Look for "See all" button specifically in item specifics section
        if (!checkPsaDataLink) {
            const itemSpecifics = document.querySelector('.ux-layout-section-evo--features');
            if (itemSpecifics) {
                const seeAllButtons = itemSpecifics.querySelectorAll('button.fake-link');
                for (const button of seeAllButtons) {
                    if (button.textContent.includes('See all')) {
                        // Check if it's in a section related to grading or certification
                        let parent = button.parentElement;
                        let foundPSAContext = false;
                        
                        // Check up to 3 levels up for PSA context
                        for (let i = 0; i < 3 && parent; i++) {
                            const parentText = parent.textContent.toLowerCase();
                            if (parentText.includes('psa') || 
                                parentText.includes('cert') || 
                                parentText.includes('grade') || 
                                parentText.includes('authentication')) {
                                foundPSAContext = true;
                                break;
                            }
                            parent = parent.parentElement;
                        }
                        
                        if (foundPSAContext) {
                            checkPsaDataLink = button;
                            console.log('Found "See all" button in PSA-related item specifics section');
                            break;
                        }
                    }
                }
            }
        }
        
        // If not found, look for spans with the right text
        if (!checkPsaDataLink) {
            const spans = document.querySelectorAll('.ux-textspans--INLINE_LINK, span');
            for (const span of spans) {
                if (span.textContent.includes('Check PSA data') || span.textContent.includes('See all')) {
                    // Check if this span is in a PSA-related context
                    let parent = span.parentElement;
                    let foundPSAContext = false;
                    
                    // Check up to 3 levels up for PSA context
                    for (let i = 0; i < 3 && parent; i++) {
                        const parentText = parent.textContent.toLowerCase();
                        if (parentText.includes('psa') || 
                            parentText.includes('cert') || 
                            parentText.includes('grade') || 
                            parentText.includes('authentication')) {
                            foundPSAContext = true;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                    
                    if (foundPSAContext || span.textContent.includes('PSA')) {
                        checkPsaDataLink = span;
                        console.log('Found span with PSA-related text:', span.textContent);
                        break;
                    }
                }
            }
        }
                           
        if (checkPsaDataLink) {
            console.log('Found "Check PSA data" link, attempting to click it to reveal cert number');
            
            try {
                // Try clicking the link to reveal the PSA data
                checkPsaDataLink.click();
                
                // Wait a short time for the data to load
                setTimeout(function() {
                    console.log('Checking for PSA cert number after clicking link');
                    
                    // After clicking, look for the cert number in the newly revealed content
                    // Give more time for the modal to fully load and render
                    setTimeout(function() {
                        const certNumberAfterClick = findCertNumberInPage();
                        if (certNumberAfterClick) {
                            console.log('Found PSA cert after clicking:', certNumberAfterClick);
                            
                            // Close the modal/dialog after extracting the cert number
                            closeModal();
                            
                            // Use the cert number to fetch PSA data
                            fetchPSAData(certNumberAfterClick);
                        } else {
                            console.log('No PSA cert found after first attempt, trying again...');
                            
                            // Try one more time with a longer delay
                            setTimeout(function() {
                                const certNumberSecondAttempt = findCertNumberInPage();
                                if (certNumberSecondAttempt) {
                                    console.log('Found PSA cert on second attempt:', certNumberSecondAttempt);
                                    
                                    // Close the modal/dialog after extracting the cert number
                                    closeModal();
                                    
                                    // Use the cert number to fetch PSA data
                                    fetchPSAData(certNumberSecondAttempt);
                                } else {
                                    console.log('No PSA cert found after clicking link');
                                    
                                    // Close the modal/dialog even if no cert found
                                    closeModal();
                                    
                                    // If still not found, fall back to manual entry
                                    addManualCertEntryButton();
                                }
                            }, 1000); // Try again after another 1 second
                        }
                    }, 500); // Initial delay of 500ms
                    
                    // Helper function to close the modal/dialog
                    function closeModal() {
                        try {
                            console.log('Attempting to close PSA data modal');
                            
                            // Method 1: Look for close buttons
                            const closeButtons = document.querySelectorAll('button.close, .close-button, .modal-close, [aria-label="Close"], button[aria-label*="close" i], button[class*="close" i]');
                            for (const button of closeButtons) {
                                if (button.offsetParent !== null) { // Check if element is visible
                                    console.log('Found close button, clicking it');
                                    button.click();
                                    return;
                                }
                            }
                            
                            // Method 2: Look for X icons
                            const closeIcons = document.querySelectorAll('.icon-close, .x-icon, svg[aria-label="Close"], svg[aria-label*="close" i], [data-testid*="close" i]');
                            for (const icon of closeIcons) {
                                if (icon.offsetParent !== null) {
                                    console.log('Found close icon, clicking it');
                                    icon.click();
                                    return;
                                }
                            }
                            
                            // Method 3: Look for elements with "close" in their class or id
                            const closeElements = document.querySelectorAll('[class*="close" i], [id*="close" i]');
                            for (const element of closeElements) {
                                if (element.offsetParent !== null) {
                                    console.log('Found element with close in class/id, clicking it');
                                    element.click();
                                    return;
                                }
                            }
                            
                            // Method 4: Press Escape key to close modal
                            console.log('Trying Escape key to close modal');
                            document.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Escape',
                                code: 'Escape',
                                keyCode: 27,
                                which: 27,
                                bubbles: true,
                                cancelable: true
                            }));
                            
                            console.log('Attempted to close modal with multiple methods');
                        } catch (e) {
                            console.log('Error while trying to close modal:', e);
                        }
                    }
                }, 1500); // Give it 1.5 seconds to load
                
                // Return null to prevent the rest of the function from executing
                // The setTimeout callback will handle the cert number when found
                return null;
            } catch (e) {
                console.log('Error clicking PSA data link:', e);
                // Continue with other methods if clicking fails
            }
        }
        
        // Method 0: Check for key-value__value class which often contains the cert number
        const keyValueElements = document.querySelectorAll('.key-value__value');
        for (const element of keyValueElements) {
            const text = element.textContent.trim();
            if (/^\d{8,}$/.test(text)) {
                // Check if this is likely a PSA cert by looking at nearby elements
                const keyLabel = element.closest('.key-value')?.querySelector('.key-value__key');
                if (keyLabel) {
                    const labelText = keyLabel.textContent.toLowerCase();
                    if (labelText.includes('certification') || 
                        labelText.includes('cert') || 
                        labelText.includes('authentication') || 
                        labelText.includes('grading') || 
                        labelText.includes('psa') || 
                        labelText.includes('serial')) {
                        console.log('Found PSA cert in key-value field with matching label:', text);
                        return text;
                    }
                }
                
                // Even if no matching label, it might still be a cert number
                console.log('Found potential PSA cert in key-value field:', text);
                return text;
            }
        }
        
        // Helper function to find cert number in page after clicking
        function findCertNumberInPage() {
            // Look for cert number in modal or popup that might appear
            // First, try to find the specific PSA certification modal
            let psaModal = null;
            const allModals = document.querySelectorAll('.modal-content, .popup-content, .dialog-content, .psa-data, [role="dialog"], [aria-modal="true"]');
            
            for (const modal of allModals) {
                const modalText = modal.textContent.toLowerCase();
                if (modalText.includes('psa') || 
                    modalText.includes('certification') || 
                    modalText.includes('graded') || 
                    modalText.includes('authentication')) {
                    psaModal = modal;
                    console.log('Found PSA-related modal');
                    break;
                }
            }
            
            // If we found a specific PSA modal, use that, otherwise check all modals
            const modalTexts = psaModal ? [psaModal] : allModals;
            
            for (const element of modalTexts) {
                const text = element.textContent;
                
                // First check for explicit certification number patterns
                // PSA cert numbers are typically 8-10 digits
                const certMatch = text.match(/Certification\s*#?\s*(\d{8,10})/i) || 
                                 text.match(/Cert\s*#?\s*(\d{8,10})/i) ||
                                 text.match(/Certificate\s*#?\s*(\d{8,10})/i) ||
                                 text.match(/PSA\s*#?\s*(\d{8,10})/i) ||
                                 text.match(/Authentication\s*#?\s*(\d{8,10})/i) ||
                                 text.match(/Grading\s*Number\s*#?\s*(\d{8,10})/i);
                if (certMatch && certMatch[1]) {
                    console.log('Found explicit certification number pattern:', certMatch[1]);
                    return certMatch[1];
                }
                
                // Check for certification number in a more structured way
                // Look for sections that contain both "PSA" and a number
                if (text.includes('PSA') || text.includes('Certification') || text.includes('Authentication')) {
                    // Split the text into smaller chunks to analyze
                    const chunks = text.split(/[\n\r\t]+/);
                    for (const chunk of chunks) {
                        // If chunk contains certification-related terms
                        if (chunk.includes('PSA') || chunk.includes('Certification') || 
                            chunk.includes('Authentication') || chunk.includes('Graded')) {
                            // Look for 8-10 digit numbers in this chunk (typical PSA cert length)
                            const numberMatch = chunk.match(/(\d{8,10})/);
                            if (numberMatch && numberMatch[1]) {
                                // Avoid eBay item numbers which are typically 12 digits
                                if (numberMatch[1].length <= 10) {
                                    console.log('Found certification number in relevant chunk:', numberMatch[1]);
                                    return numberMatch[1];
                                }
                            }
                        }
                    }
                }
            }
            
            // Check for newly appeared elements with the cert number
            const newKeyValueElements = document.querySelectorAll('.key-value__value, [role="dialog"] span, [aria-modal="true"] span');
            for (const element of newKeyValueElements) {
                const text = element.textContent.trim();
                if (/^\d{8,}$/.test(text)) {
                    return text;
                }
            }
            
            // Try to find PSA certification number in structured content
            // Look for elements that might contain certification info
            const certElements = document.querySelectorAll('[role="dialog"] [class*="cert" i], [aria-modal="true"] [class*="cert" i], .modal-content [class*="cert" i], .dialog-content [class*="cert" i]');
            
            for (const element of certElements) {
                const text = element.textContent.trim();
                // Look for a standalone number that matches PSA cert pattern
                const match = text.match(/(\d{8,10})/g);
                if (match && match[0] && isLikelyPSACertNumber(match[0])) {
                    console.log('Found PSA cert number in certification element:', match[0]);
                    return match[0];
                }
            }
            
            // First, look for the exact PSA::PSACERT::number format
            const modalElement = document.querySelector('[role="dialog"], [aria-modal="true"], .modal-content, .dialog-content');
            if (modalElement) {
                // Look for elements with data attributes that might contain the PSA cert ID
                const allElements = modalElement.querySelectorAll('*');
                for (const element of allElements) {
                    // Check all attributes of the element
                    for (const attr of element.attributes) {
                        const attrValue = attr.value;
                        // Look for the specific PSA::PSACERT:: format
                        const psaMatch = attrValue.match(/PSA::PSACERT::([\d]+)/i);
                        if (psaMatch && psaMatch[1] && isLikelyPSACertNumber(psaMatch[1])) {
                            console.log('Found exact PSA::PSACERT:: format:', psaMatch[1]);
                            return psaMatch[1];
                        }
                        
                        // Also check for JSON-like strings that might contain the PSA cert
                        if (attrValue.includes('PSA') && attrValue.includes('CERT')) {
                            try {
                                // Try to parse as JSON if it looks like JSON
                                if (attrValue.includes('{') && attrValue.includes('}')) {
                                    const jsonObj = JSON.parse(attrValue);
                                    // Check various properties that might contain the cert
                                    const jsonStr = JSON.stringify(jsonObj);
                                    const psaJsonMatch = jsonStr.match(/PSA::PSACERT::([\d]+)/i);
                                    if (psaJsonMatch && psaJsonMatch[1] && isLikelyPSACertNumber(psaJsonMatch[1])) {
                                        console.log('Found PSA cert in JSON attribute:', psaJsonMatch[1]);
                                        return psaJsonMatch[1];
                                    }
                                }
                            } catch (e) {
                                // Not valid JSON, try regex directly
                                const psaAttrMatch = attrValue.match(/PSA::PSACERT::([\d]+)/i);
                                if (psaAttrMatch && psaAttrMatch[1] && isLikelyPSACertNumber(psaAttrMatch[1])) {
                                    console.log('Found PSA cert in attribute:', psaAttrMatch[1]);
                                    return psaAttrMatch[1];
                                }
                            }
                        }
                    }
                }
            }
            
            // If the specific format wasn't found, check the modal rows as before
            const modalRows = document.querySelectorAll('[role="dialog"] tr, [aria-modal="true"] tr, .modal-content tr, .dialog-content tr');
            for (const row of modalRows) {
                const cells = row.querySelectorAll('td, th');
                
                // First check if this row contains certification-related text
                const rowText = row.textContent.toLowerCase();
                const isCertificationRow = rowText.includes('certification') || 
                                          rowText.includes('cert') || 
                                          rowText.includes('authentication') || 
                                          rowText.includes('psa') || 
                                          rowText.includes('graded');
                
                if (isCertificationRow) {
                    // This row is likely related to certification, check all cells for a number
                    for (const cell of cells) {
                        const text = cell.textContent.trim();
                        // Look for 8-10 digit numbers that are likely PSA cert numbers
                        const certMatch = text.match(/(\d{8,10})/);
                        if (certMatch && certMatch[1]) {
                            // Avoid eBay item numbers which are typically 12 digits
                            if (certMatch[1].length <= 10) {
                                console.log('Found cert number in certification row:', certMatch[1]);
                                return certMatch[1];
                            }
                        }
                    }
                }
            }
            
            // If we couldn't find a certification number in rows with cert-related text,
            // look more carefully at the modal content
            const modalContent = document.querySelector('[role="dialog"], [aria-modal="true"], .modal-content, .dialog-content');
            if (modalContent) {
                // Look for the PSA certification ID in the modal's HTML
                const modalHtml = modalContent.innerHTML;
                const psaHtmlMatch = modalHtml.match(/PSA::PSACERT::([\d]+)/i);
                if (psaHtmlMatch && psaHtmlMatch[1] && isLikelyPSACertNumber(psaHtmlMatch[1])) {
                    console.log('Found PSA cert ID in modal HTML:', psaHtmlMatch[1]);
                    return psaHtmlMatch[1];
                }
                
                // Get all text nodes in the modal
                const textNodes = [];
                const walker = document.createTreeWalker(
                    modalContent,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );
                
                let node;
                while (node = walker.nextNode()) {
                    textNodes.push({
                        node: node,
                        text: node.textContent.trim()
                    });
                }
                
                // Look for nodes with certification-related text
                for (const item of textNodes) {
                    const text = item.text.toLowerCase();
                    if (text.includes('certification') || text.includes('cert') || 
                        text.includes('authentication') || text.includes('psa') || 
                        text.includes('graded')) {
                        
                        // Check nearby nodes (within 5 positions) for numbers
                        const index = textNodes.indexOf(item);
                        const start = Math.max(0, index - 5);
                        const end = Math.min(textNodes.length, index + 5);
                        
                        for (let i = start; i < end; i++) {
                            const nearbyText = textNodes[i].text;
                            const certMatch = nearbyText.match(/(\d{8,10})/);
                            if (certMatch && certMatch[1]) {
                                // Avoid eBay item numbers which are typically 12 digits
                                if (certMatch[1].length <= 10) {
                                    console.log('Found cert number near certification text:', certMatch[1]);
                                    return certMatch[1];
                                }
                            }
                        }
                    }
                }
            }
            
            // Check for any new elements containing digits that might be the cert
            // but be more careful to avoid eBay listing IDs
            const allElements = document.querySelectorAll('*');
            
            // First, look for elements with certification-related context
            for (const element of allElements) {
                if (element.children.length === 0) { // Only check leaf nodes
                    const text = element.textContent.trim();
                    if (/^\d{8,}$/.test(text)) {
                        // Check if this element has certification-related context
                        let parent = element.parentElement;
                        let depth = 0;
                        const maxDepth = 3; // Check up to 3 levels up
                        
                        while (parent && depth < maxDepth) {
                            const parentText = parent.textContent.toLowerCase();
                            if (parentText.includes('psa') || 
                                parentText.includes('cert') || 
                                parentText.includes('authentication') || 
                                parentText.includes('graded')) {
                                console.log('Found number in certification context:', text);
                                return text;
                            }
                            parent = parent.parentElement;
                            depth++;
                        }
                    }
                }
            }
            
            // If we still haven't found a cert number, be more selective
            // Look for standalone numbers that are likely PSA cert numbers (usually 8-10 digits)
            // but avoid common eBay patterns like item numbers
            const potentialCertNumbers = [];
            
            for (const element of allElements) {
                if (element.children.length === 0) { // Only check leaf nodes
                    const text = element.textContent.trim();
                    // Match standalone numbers with 8-10 digits (typical PSA cert length)
                    if (/^\d{8,10}$/.test(text)) {
                        // Avoid eBay item numbers which often appear with specific labels
                        const parent = element.parentElement;
                        if (parent) {
                            const parentText = parent.textContent.toLowerCase();
                            if (!parentText.includes('item') && 
                                !parentText.includes('listing') && 
                                !parentText.includes('ebay')) {
                                potentialCertNumbers.push(text);
                            }
                        } else {
                            potentialCertNumbers.push(text);
                        }
                    }
                }
            }
            
            // If we found potential cert numbers, return the first one
            if (potentialCertNumbers.length > 0) {
                console.log('Found potential cert number:', potentialCertNumbers[0]);
                return potentialCertNumbers[0];
            }
            
            return null;
        }
        
        // Method 1: Look for PSA cert number in item specifics section
        const itemSpecificsSection = document.querySelector('.ux-layout-section-evo--features');
        if (itemSpecificsSection) {
            // Check for Professional Grader field
            const professionalGraderElements = itemSpecificsSection.querySelectorAll('.ux-labels-values--professionalGrader .ux-labels-values__values-content div span');
            for (const element of professionalGraderElements) {
                const text = element.textContent.trim();
                if (/^\d{8,}$/.test(text)) {
                    console.log('Found PSA cert in Professional Grader field:', text);
                    return text;
                }
            }
            
            // Check for Authentication/Grading Number field
            const authElements = itemSpecificsSection.querySelectorAll('.ux-labels-values--authenticationGradingNumber .ux-labels-values__values-content div span');
            for (const element of authElements) {
                const text = element.textContent.trim();
                if (/^\d{8,}$/.test(text)) {
                    console.log('Found PSA cert in Authentication/Grading Number field:', text);
                    return text;
                }
            }
            
            // Check for Certification Number field
            const certElements = itemSpecificsSection.querySelectorAll('.ux-labels-values--certificationNumber .ux-labels-values__values-content div span');
            for (const element of certElements) {
                const text = element.textContent.trim();
                if (/^\d{8,}$/.test(text)) {
                    console.log('Found PSA cert in Certification Number field:', text);
                    return text;
                }
            }
            
            // Check for Grade field
            const gradeElements = itemSpecificsSection.querySelectorAll('.ux-labels-values--grade .ux-labels-values__values-content div span');
            for (const element of gradeElements) {
                const text = element.textContent.trim();
                // Sometimes the cert number is in the grade field with format "PSA 10 #12345678"
                const certMatch = text.match(/PSA\s*\d+\s*#?\s*(\d{8,})/i);
                if (certMatch && certMatch[1]) {
                    console.log('Found PSA cert in Grade field:', certMatch[1]);
                    return certMatch[1];
                }
            }
            
            // Check all item specifics fields for a PSA cert number pattern
            const allSpecificsElements = itemSpecificsSection.querySelectorAll('.ux-labels-values__values-content div span');
            for (const element of allSpecificsElements) {
                const text = element.textContent.trim();
                const certMatch = text.match(/PSA\s*#?\s*(\d{8,})/i) || 
                                 text.match(/Cert\s*#?\s*(\d{8,})/i) ||
                                 text.match(/Certificate\s*#?\s*(\d{8,})/i) ||
                                 text.match(/Serial\s*#?\s*(\d{8,})/i);
                if (certMatch && certMatch[1]) {
                    console.log('Found PSA cert in item specifics:', certMatch[1]);
                    return certMatch[1];
                }
            }
        }
        
        // Method 2: Look for "Check PSA data" or "See all" link
        const psaDataLink = document.querySelector('button[data-clientpresentationmetadata*="CARD_INSIGHTS_PSA"]') || 
                           document.querySelector('button.fake-link[data-vi-tracking*="CLICK"]');
        
        // Method 2.1: Try to extract PSA cert ID directly from data attributes
        if (!psaDataLink) {
            // Look for elements with data attributes that might contain PSA certification info
            const allElements = document.querySelectorAll('*[data-*]');
            for (const element of allElements) {
                // Check all attributes of the element
                for (const attr of element.attributes) {
                    if (attr.name.startsWith('data-')) {
                        const attrValue = attr.value;
                        // Look for the specific PSA::PSACERT:: format
                        const psaMatch = attrValue.match(/PSA::PSACERT::([\d]+)/i);
                        if (psaMatch && psaMatch[1]) {
                            console.log('Found PSA cert ID in data attribute:', psaMatch[1]);
                            fetchPSAData(psaMatch[1]);
                            return psaMatch[1];
                        }
                        
                        // Check if attribute value might be JSON
                        if (attrValue.includes('{') && attrValue.includes('}') && 
                            (attrValue.includes('PSA') || attrValue.includes('cert'))) {
                            try {
                                // Try to parse as JSON
                                const jsonObj = JSON.parse(attrValue);
                                // Convert to string for easier searching
                                const jsonStr = JSON.stringify(jsonObj);
                                const psaJsonMatch = jsonStr.match(/PSA::PSACERT::([\d]+)/i);
                                if (psaJsonMatch && psaJsonMatch[1]) {
                                    console.log('Found PSA cert ID in JSON data attribute:', psaJsonMatch[1]);
                                    fetchPSAData(psaJsonMatch[1]);
                                    return psaJsonMatch[1];
                                }
                            } catch (e) {
                                // Not valid JSON, continue
                            }
                        }
                    }
                }
            }
        }
        if (psaDataLink) {
            // The link exists, but we need to extract the cert number from somewhere else
            // This is just a marker that this is a PSA graded item
            
            // Try to find cert number in the item description
            const itemDescription = document.querySelector('#desc_ifr');
            if (itemDescription && itemDescription.contentDocument) {
                const descriptionText = itemDescription.contentDocument.body.textContent;
                const certMatch = descriptionText.match(/PSA\s*#?\s*(\d{8,})/i) || 
                                 descriptionText.match(/Cert\s*#?\s*(\d{8,})/i) ||
                                 descriptionText.match(/Certificate\s*#?\s*(\d{8,})/i) ||
                                 descriptionText.match(/Serial\s*#?\s*(\d{8,})/i) ||
                                 descriptionText.match(/Authentication\s*#?\s*(\d{8,})/i);
                if (certMatch && certMatch[1]) {
                    console.log('Found PSA cert in description:', certMatch[1]);
                    return certMatch[1];
                }
            }
        }
        
        // Method 3: Look for PSA number in the title or subtitle
        const titleElement = document.querySelector('.x-item-title__mainTitle span');
        if (titleElement) {
            const titleText = titleElement.textContent;
            const certMatch = titleText.match(/PSA\s*#?\s*(\d{8,})/i) ||
                             titleText.match(/Cert\s*#?\s*(\d{8,})/i) ||
                             titleText.match(/Certificate\s*#?\s*(\d{8,})/i);
            if (certMatch && certMatch[1]) {
                console.log('Found PSA cert in title:', certMatch[1]);
                return certMatch[1];
            }
        }
        
        // Method 4: Look for PSA number in any text on the page
        // This is a last resort method that might find false positives
        // but we'll limit it to elements near PSA mentions
        // Use a custom function to find elements containing text since :contains() is not standard
        function findElementsContainingText(text) {
            const elements = [];
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        return node.nodeValue.includes(text) ? 
                            NodeFilter.FILTER_ACCEPT : 
                            NodeFilter.FILTER_REJECT;
                    }
                }
            );
            
            let node;
            while (node = walker.nextNode()) {
                elements.push(node.parentNode);
            }
            
            return elements;
        }
        
        // Method 4.1: Look for the specific PSA::PSACERT:: format in the page HTML
        const pageHtml = document.documentElement.innerHTML;
        const psaPageMatch = pageHtml.match(/PSA::PSACERT::([\d]+)/i);
        if (psaPageMatch && psaPageMatch[1] && isLikelyPSACertNumber(psaPageMatch[1])) {
            console.log('Found PSA cert ID in page HTML:', psaPageMatch[1]);
            return psaPageMatch[1];
        }
        
        const psaMentions = findElementsContainingText('PSA');
        for (const element of psaMentions) {
            // Skip elements that are too large (like body or main containers)
            if (element.children && element.children.length > 10) continue;
            
            const text = element.textContent;
            if (text.length > 500) continue; // Skip very large text blocks
            
            const certMatch = text.match(/PSA\s*#?\s*(\d{8,})/i) || 
                             text.match(/Cert\s*#?\s*(\d{8,})/i) ||
                             text.match(/Certificate\s*#?\s*(\d{8,})/i);
            if (certMatch && certMatch[1]) {
                console.log('Found PSA cert in page text:', certMatch[1]);
                return certMatch[1];
            }
        }
        
        // If we couldn't find the cert number but we know it's a PSA graded item,
        // show a button to manually enter the cert number
        
        // Check for PSA mentions in various elements without using :contains selector
        let isPsaItem = false;
        
        // Check for "Graded - PSA" text in ux-textspans
        const textSpans = document.querySelectorAll('.ux-textspans');
        for (const span of textSpans) {
            if (span.textContent.includes('Graded - PSA') || span.textContent.includes('PSA')) {
                isPsaItem = true;
                break;
            }
        }
        
        // Check for PSA text in spans
        if (!isPsaItem) {
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
                if (span.textContent.includes('PSA')) {
                    isPsaItem = true;
                    break;
                }
            }
        }
        
        // Check for "PSA Graded" text in divs
        if (!isPsaItem) {
            const divs = document.querySelectorAll('div');
            for (const div of divs) {
                if (div.textContent.includes('PSA Graded')) {
                    isPsaItem = true;
                    break;
                }
            }
        }
        
        if (isPsaItem) {
            console.log('PSA item detected, but no cert number found. Adding manual entry button.');
            addManualCertEntryButton();
            return null;
        }
        
        return null;
    }

    function fetchPSAData(certNumber) {
        // First check if we have cached data
        const cachedData = CacheManager.getData(certNumber);
        if (cachedData) {
            console.log('Using cached PSA data for cert:', certNumber);
            displayPSAData(cachedData);
            return;
        }
        
        // No cached data, need to fetch from PSA website
        // Updated URL format to match the correct PSA website structure
        const psaUrl = `https://www.psacard.com/cert/${certNumber}/psa`;
        
        console.log('Fetching PSA data from:', psaUrl);
        
        // Create a loading indicator
        const loadingDiv = createLoadingIndicator();
        insertPSADataContainer(loadingDiv);
        
        // Use GM_xmlhttpRequest to fetch data from PSA website
        GM_xmlhttpRequest({
            method: 'GET',
            url: psaUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 30000, // 30 seconds timeout
            onload: function(response) {
                console.log('PSA response received, status:', response.status);
                if (response.status === 200) {
                    const psaData = extractPSADataFromHTML(response.responseText, certNumber);
                    
                    // Cache the data for future use
                    CacheManager.saveData(certNumber, psaData);
                    
                    displayPSAData(psaData);
                } else {
                    console.error('Failed to fetch PSA data. Status:', response.status);
                    console.error('Response text:', response.responseText.substring(0, 200) + '...');
                    
                    // Try alternative URL format as fallback
                    const altPsaUrl = `https://www.psacard.com/cert/${certNumber}`;
                    console.log('Trying alternative URL:', altPsaUrl);
                    
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: altPsaUrl,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        },
                        timeout: 30000,
                        onload: function(altResponse) {
                            console.log('Alternative PSA response received, status:', altResponse.status);
                            if (altResponse.status === 200) {
                                const psaData = extractPSADataFromHTML(altResponse.responseText, certNumber);
                                
                                // Cache the data for future use
                                CacheManager.saveData(certNumber, psaData);
                                
                                displayPSAData(psaData);
                            } else {
                                displayError(`Failed to fetch PSA data. Status: ${response.status}. The number ${certNumber} might be an eBay item ID rather than a PSA certification number. Please verify the certification number is correct.`);
                            }
                        },
                        onerror: function(altError) {
                            displayError('Error fetching PSA data: ' + (altError.message || 'Unknown error'));
                        }
                    });
                }
            },
            onerror: function(error) {
                console.error('Error fetching PSA data:', error);
                displayError('Error fetching PSA data: ' + (error.message || 'Unknown error'));
            }
        });
    }

    function extractPSADataFromHTML(html, certNumber) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        console.log('Parsing PSA HTML response...');
        
        // Debug: Log the HTML structure to help identify elements
        console.log('HTML structure sample:', html.substring(0, 500));
        
        // Debug: Look specifically for card name elements
        const possibleCardNameElements = [
            doc.querySelector('.cert-card-details h1'),
            doc.querySelector('.item-details h1'),
            doc.querySelector('.cert-header h1'),
            doc.querySelector('.card-details h1'),
            doc.querySelector('h1.card-title'),
            doc.querySelector('p.text-center.text-display5.uppercase'),
            doc.querySelector('p.text-center.uppercase'),
            doc.querySelector('p.text-display5.uppercase'),
            doc.querySelector('p.uppercase'),
            doc.querySelector('.card-name')
        ];
        
        console.log('Possible card name elements:');
        possibleCardNameElements.forEach((el, index) => {
            if (el) {
                console.log(`Element ${index} found:`, el.tagName, 'with text:', el.textContent.trim());
            }
        });
        
        // Extract card details - updated selectors for current PSA website
        let cardName = doc.querySelector('.cert-card-details h1')?.textContent.trim() || 
                      doc.querySelector('.item-details h1')?.textContent.trim() || 
                      doc.querySelector('.cert-header h1')?.textContent.trim() ||
                      doc.querySelector('.card-details h1')?.textContent.trim() ||
                      doc.querySelector('h1.card-title')?.textContent.trim() ||
                      doc.querySelector('p.text-center.text-display5.uppercase')?.textContent.trim() ||
                      doc.querySelector('p.text-center.uppercase')?.textContent.trim() ||
                      doc.querySelector('p.text-display5.uppercase')?.textContent.trim() ||
                      doc.querySelector('p.uppercase')?.textContent.trim() ||
                      doc.querySelector('.card-name')?.textContent.trim();
        
        // If we still don't have a card name, try a more generic approach
        if (!cardName) {
            // Look for elements with uppercase text that might contain the card name
            const allElements = doc.querySelectorAll('p, h1, h2, h3, div');
            for (const element of allElements) {
                const text = element.textContent.trim();
                // Look for text that's all uppercase and contains typical card identifiers
                if (text === text.toUpperCase() && text.length > 10 && 
                    (text.includes('#') || 
                     /\d{4}/.test(text) || // Contains a 4-digit year
                     /[A-Z]{3,}/.test(text))) { // Contains at least 3 uppercase letters in a row
                    cardName = text;
                    console.log('Found card name using generic approach:', cardName);
                    break;
                }
            }
        }
        
        // If still no card name, use default
        if (!cardName) {
            cardName = 'Unknown Card';
        }
        
        console.log('Found card name:', cardName);
        
        // Extract card details/description
        const cardDetails = doc.querySelector('.cert-card-details')?.textContent.trim() || 
                           doc.querySelector('.item-details')?.textContent.trim() || 
                           doc.querySelector('.card-details')?.textContent.trim() ||
                           doc.querySelector('.cert-details')?.textContent.trim() ||
                           '';
        
        // Extract grade - updated selectors
        let grade = 'Unknown Grade';
        const gradeSelectors = [
            '.cert-grade-box', 
            '.grade-box', 
            '.cert-grade',
            '.grade-value',
            '.grade',
            '.psa-grade'
        ];
        
        for (const selector of gradeSelectors) {
            const gradeElement = doc.querySelector(selector);
            if (gradeElement) {
                grade = gradeElement.textContent.trim();
                console.log('Found grade with selector', selector, ':', grade);
                break;
            }
        }
        
        // If grade still not found, try to extract from text
        if (grade === 'Unknown Grade') {
            const gradeRegex = /PSA\s+(\d+(\.\d+)?)/i;
            const pageText = doc.body.textContent;
            const gradeMatch = pageText.match(gradeRegex);
            if (gradeMatch && gradeMatch[1]) {
                grade = `PSA ${gradeMatch[1]}`;
                console.log('Extracted grade from text:', grade);
            }
        }
        
        // Extract price data if available
        let priceData = {};
        
        // Try multiple possible selectors for price data
        const priceSectionSelectors = [
            '.cert-pop-chart', 
            '.price-chart', 
            '.sales-history',
            '.price-guide',
            '.value-section',
            '.smr-table',
            'table.price-data'
        ];
        
        let priceSection = null;
        for (const selector of priceSectionSelectors) {
            priceSection = doc.querySelector(selector);
            if (priceSection) {
                console.log('Found price section with selector:', selector);
                break;
            }
        }
        
        if (priceSection) {
            // Extract price data from the price section
            const priceRows = priceSection.querySelectorAll('tr');
            priceRows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    const gradeLabel = cells[0].textContent.trim();
                    const priceValue = cells[1].textContent.trim();
                    priceData[gradeLabel] = priceValue;
                    console.log('Price data:', gradeLabel, '=', priceValue);
                }
            });
        }
        
        // Try alternative price data extraction methods
        if (Object.keys(priceData).length === 0) {
            // Method 1: Look for price elements with specific classes
            const priceElementSelectors = [
                '.price-value', 
                '.avg-price', 
                '[data-price]',
                '.value',
                '.smr-value',
                '.price-estimate'
            ];
            
            for (const selector of priceElementSelectors) {
                const priceElement = doc.querySelector(selector);
                if (priceElement) {
                    const currentGrade = grade.replace(/[^\d.]/g, '');
                    priceData[`PSA ${currentGrade}`] = priceElement.textContent.trim();
                    console.log('Found price with selector', selector, ':', priceElement.textContent.trim());
                    break;
                }
            }
            
            // Method 2: Look for currency patterns in the page
            if (Object.keys(priceData).length === 0) {
                // Find all elements containing dollar signs
                const allElements = doc.querySelectorAll('*');
                for (const element of allElements) {
                    if (element.textContent.includes('$')) {
                        const text = element.textContent.trim();
                        // Look for price patterns like $1,234.56
                        const priceMatch = text.match(/\$[\d,]+\.\d{2}/);
                        if (priceMatch) {
                            // Check if this is in context of the current grade
                            const elementText = element.textContent.toLowerCase();
                            const currentGradeNum = grade.replace(/[^\d.]/g, '');
                            
                            if (elementText.includes(`psa ${currentGradeNum}`) || 
                                elementText.includes(`grade ${currentGradeNum}`) ||
                                elementText.includes(`value`) ||
                                elementText.includes(`price`) ||
                                elementText.includes(`estimate`)) {
                                
                                priceData[`PSA ${currentGradeNum}`] = priceMatch[0];
                                console.log('Found price in text:', priceMatch[0], 'context:', text.substring(0, 50));
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        // Extract population data - updated selectors
        let popData = {};
        
        // Debug: Look specifically for population data elements
        console.log('Looking for population data elements...');
        
        // Method 1: Look for the specific link element you provided
        const popLinks = doc.querySelectorAll('a.text-hyperlink[data-testid="link"][href*="/pop/"]');
        if (popLinks.length > 0) {
            console.log('Found population link elements:', popLinks.length);
            for (const link of popLinks) {
                const popCount = link.textContent.trim();
                if (/^\d+$/.test(popCount)) {
                    const currentGradeNum = grade.replace(/[^\d.]/g, '');
                    popData[`PSA ${currentGradeNum}`] = popCount;
                    console.log('Found population from link:', popCount);
                    break;
                }
            }
        }
        
        // Method 2: Look for any links with "/pop/" in the href
        if (Object.keys(popData).length === 0) {
            const allPopLinks = doc.querySelectorAll('a[href*="/pop/"]');
            console.log('Found all population links:', allPopLinks.length);
            for (const link of allPopLinks) {
                const popCount = link.textContent.trim();
                if (/^\d+$/.test(popCount)) {
                    const currentGradeNum = grade.replace(/[^\d.]/g, '');
                    popData[`PSA ${currentGradeNum}`] = popCount;
                    console.log('Found population from general pop link:', popCount);
                    break;
                }
            }
        }
        
        // Method 3: Look for elements with specific classes that might contain population data
        if (Object.keys(popData).length === 0) {
            const popSectionSelectors = [
                '.cert-pop', 
                '.population', 
                '.pop-report',
                '.population-data',
                '.pop-table',
                'table.population',
                '[data-testid="population"]',
                '.text-center.text-body1.font-semibold'
            ];
            
            let popSection = null;
            for (const selector of popSectionSelectors) {
                const elements = doc.querySelectorAll(selector);
                for (const element of elements) {
                    const text = element.textContent.trim();
                    // If the text is just a number, it might be population data
                    if (/^\d+$/.test(text)) {
                        const currentGradeNum = grade.replace(/[^\d.]/g, '');
                        popData[`PSA ${currentGradeNum}`] = text;
                        console.log('Found population from selector:', selector, '=', text);
                        popSection = element;
                        break;
                    }
                }
                if (popSection) break;
            }
            
            // If we found a population section with a table structure, extract data from it
            if (popSection && popSection.tagName === 'TABLE') {
                const popRows = popSection.querySelectorAll('tr');
                popRows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        const gradeLabel = cells[0].textContent.trim();
                        const popCount = cells[1].textContent.trim();
                        popData[gradeLabel] = popCount;
                        console.log('Population data from table:', gradeLabel, '=', popCount);
                    }
                });
            }
        }
        
        // Method 4: Look for text-based population info
        if (Object.keys(popData).length === 0) {
            // Look for elements with "population" in their text
            const popElements = Array.from(doc.querySelectorAll('*')).filter(el => 
                el.textContent.toLowerCase().includes('population') || 
                el.textContent.toLowerCase().includes('pop:') ||
                el.textContent.toLowerCase().includes('pop ')
            );
            
            for (const element of popElements) {
                // Look for nearby elements with just numbers
                const siblings = getSiblingElements(element);
                for (const sibling of siblings) {
                    const text = sibling.textContent.trim();
                    if (/^\d+$/.test(text)) {
                        const currentGradeNum = grade.replace(/[^\d.]/g, '');
                        popData[`PSA ${currentGradeNum}`] = text;
                        console.log('Found population from nearby element:', text);
                        break;
                    }
                }
                
                if (Object.keys(popData).length > 0) break;
                
                // If no siblings with just numbers, try to extract from the element itself
                const text = element.textContent.trim();
                const popMatch = text.match(/population[:\s]+(\d+)/i) || 
                                text.match(/pop[:\s]+(\d+)/i);
                
                if (popMatch && popMatch[1]) {
                    const currentGradeNum = grade.replace(/[^\d.]/g, '');
                    popData[`PSA ${currentGradeNum}`] = popMatch[1];
                    console.log('Found population from text match:', popMatch[1]);
                    break;
                }
            }
        }
        
        // Method 5: Last resort - look for any standalone numbers that might be population
        if (Object.keys(popData).length === 0) {
            // Find elements that contain only a number and might be population data
            const numberElements = Array.from(doc.querySelectorAll('*')).filter(el => {
                const text = el.textContent.trim();
                return /^\d+$/.test(text) && 
                       text.length <= 6 && // Population counts are usually not extremely large
                       el.children.length === 0; // Only leaf nodes
            });
            
            // Sort by parent element proximity to elements containing "pop" or "population"
            const popKeywords = ['pop', 'population'];
            numberElements.sort((a, b) => {
                const aScore = getPopKeywordProximityScore(a, popKeywords);
                const bScore = getPopKeywordProximityScore(b, popKeywords);
                return bScore - aScore; // Higher score first
            });
            
            if (numberElements.length > 0) {
                const currentGradeNum = grade.replace(/[^\d.]/g, '');
                const popCount = numberElements[0].textContent.trim();
                popData[`PSA ${currentGradeNum}`] = popCount;
                console.log('Found potential population from standalone number:', popCount);
            }
        }
        
        // Helper function to get sibling and nearby elements
        function getSiblingElements(element) {
            const siblings = [];
            
            // Get direct siblings
            let sibling = element.nextElementSibling;
            if (sibling) siblings.push(sibling);
            
            sibling = element.previousElementSibling;
            if (sibling) siblings.push(sibling);
            
            // Get parent siblings if available
            if (element.parentElement) {
                sibling = element.parentElement.nextElementSibling;
                if (sibling) siblings.push(sibling);
                
                sibling = element.parentElement.previousElementSibling;
                if (sibling) siblings.push(sibling);
            }
            
            // Add children of parent (other siblings)
            if (element.parentElement) {
                const children = element.parentElement.children;
                for (const child of children) {
                    if (child !== element) siblings.push(child);
                }
            }
            
            return siblings;
        }
        
        // Helper function to score elements by proximity to population keywords
        function getPopKeywordProximityScore(element, keywords) {
            let score = 0;
            
            // Check element's own text
            const ownText = element.textContent.toLowerCase();
            for (const keyword of keywords) {
                if (ownText.includes(keyword)) {
                    score += 10;
                    break;
                }
            }
            
            // Check parent
            if (element.parentElement) {
                const parentText = element.parentElement.textContent.toLowerCase();
                for (const keyword of keywords) {
                    if (parentText.includes(keyword)) {
                        score += 5;
                        break;
                    }
                }
            }
            
            // Check siblings
            const siblings = getSiblingElements(element);
            for (const sibling of siblings) {
                const siblingText = sibling.textContent.toLowerCase();
                for (const keyword of keywords) {
                    if (siblingText.includes(keyword)) {
                        score += 3;
                        break;
                    }
                }
            }
            
            return score;
        }
        
        console.log('Extracted PSA data:', {
            certNumber,
            cardName,
            grade,
            priceData,
            popData
        });
        
        return {
            certNumber,
            cardName,
            cardDetails,
            grade,
            priceData,
            popData
        };
    }
    
    function displayPSAData(psaData) {
        // Remove loading indicator if it exists
        const loadingIndicator = document.getElementById('psa-data-loading');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
        
        // Create container for PSA data
        const container = document.createElement('div');
        container.id = 'psa-data-container';
        container.style.border = '1px solid #e5e5e5';
        container.style.borderRadius = '4px';
        container.style.padding = '15px';
        container.style.marginTop = '15px';
        container.style.backgroundColor = '#f8f8f8';
        
        // Add cached indicator if this is from cache
        const isCached = psaData._fromCache === true;
        if (isCached) {
            const cachedBadge = document.createElement('div');
            cachedBadge.style.position = 'absolute';
            cachedBadge.style.top = '5px';
            cachedBadge.style.right = '5px';
            cachedBadge.style.padding = '2px 5px';
            cachedBadge.style.fontSize = '10px';
            cachedBadge.style.backgroundColor = '#e8f4f8';
            cachedBadge.style.color = '#0654ba';
            cachedBadge.style.borderRadius = '3px';
            cachedBadge.textContent = 'Cached';
            cachedBadge.title = 'Data loaded from cache';
            container.appendChild(cachedBadge);
            
            // Make container position relative for absolute positioning of badge
            container.style.position = 'relative';
        }
        
        // Create header
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '10px';
        
        const title = document.createElement('h3');
        title.textContent = 'PSA Card Data';
        title.style.margin = '0';
        title.style.fontSize = '16px';
        title.style.fontWeight = 'bold';
        
        const psaLogo = document.createElement('img');
        // Use the hosted PSA logo image
        psaLogo.src = 'https://cconnect.s3.amazonaws.com/wp-content/uploads/2025/08/605205-1024x394.png';
        psaLogo.alt = 'PSA Logo';
        psaLogo.style.height = '20px';
        psaLogo.onerror = function() {
            // Fallback to original PSA website image if hosted image fails to load
            console.log('Hosted PSA logo failed to load, using fallback');
            this.src = 'https://www.psacard.com/images/logo-psa.svg';
        };
        
        header.appendChild(title);
        header.appendChild(psaLogo);
        container.appendChild(header);
        
        // Card info section
        const cardInfo = document.createElement('div');
        cardInfo.style.marginBottom = '10px';
        
        const cardName = document.createElement('div');
        cardName.textContent = psaData.cardName;
        cardName.style.fontWeight = 'bold';
        cardInfo.appendChild(cardName);
        
        const certNumber = document.createElement('div');
        certNumber.textContent = `Certification #: ${psaData.certNumber}`;
        certNumber.style.fontSize = '14px';
        cardInfo.appendChild(certNumber);
        
        const grade = document.createElement('div');
        grade.textContent = `Grade: ${psaData.grade}`;
        grade.style.fontSize = '14px';
        grade.style.fontWeight = 'bold';
        cardInfo.appendChild(grade);
        
        container.appendChild(cardInfo);
        
        // Price data section
        if (Object.keys(psaData.priceData).length > 0) {
            const priceSection = document.createElement('div');
            priceSection.style.marginTop = '10px';
            
            const priceTitle = document.createElement('div');
            priceTitle.textContent = 'Price Estimates:';
            priceTitle.style.fontWeight = 'bold';
            priceTitle.style.marginBottom = '5px';
            priceSection.appendChild(priceTitle);
            
            const priceTable = document.createElement('table');
            priceTable.style.width = '100%';
            priceTable.style.borderCollapse = 'collapse';
            
            // Table header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            
            const gradeHeader = document.createElement('th');
            gradeHeader.textContent = 'Grade';
            gradeHeader.style.textAlign = 'left';
            gradeHeader.style.padding = '5px';
            headerRow.appendChild(gradeHeader);
            
            const priceHeader = document.createElement('th');
            priceHeader.textContent = 'Est. Value';
            priceHeader.style.textAlign = 'right';
            priceHeader.style.padding = '5px';
            headerRow.appendChild(priceHeader);
            
            thead.appendChild(headerRow);
            priceTable.appendChild(thead);
            
            // Table body
            const tbody = document.createElement('tbody');
            
            for (const [grade, price] of Object.entries(psaData.priceData)) {
                const row = document.createElement('tr');
                
                const gradeCell = document.createElement('td');
                gradeCell.textContent = grade;
                gradeCell.style.padding = '5px';
                row.appendChild(gradeCell);
                
                const priceCell = document.createElement('td');
                priceCell.textContent = price;
                priceCell.style.textAlign = 'right';
                priceCell.style.padding = '5px';
                row.appendChild(priceCell);
                
                tbody.appendChild(row);
            }
            
            priceTable.appendChild(tbody);
            priceSection.appendChild(priceTable);
            container.appendChild(priceSection);
        } else {
            const noPriceData = document.createElement('div');
            noPriceData.textContent = 'No price data available from PSA';
            noPriceData.style.fontStyle = 'italic';
            noPriceData.style.marginTop = '10px';
            container.appendChild(noPriceData);
        }
        
        // Population data section
        if (Object.keys(psaData.popData).length > 0) {
            const popSection = document.createElement('div');
            popSection.style.marginTop = '15px';
            
            const popTitle = document.createElement('div');
            popTitle.textContent = 'Population Data:';
            popTitle.style.fontWeight = 'bold';
            popTitle.style.marginBottom = '5px';
            popSection.appendChild(popTitle);
            
            const popTable = document.createElement('table');
            popTable.style.width = '100%';
            popTable.style.borderCollapse = 'collapse';
            
            // Table header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            
            const gradeHeader = document.createElement('th');
            gradeHeader.textContent = 'Grade';
            gradeHeader.style.textAlign = 'left';
            gradeHeader.style.padding = '5px';
            headerRow.appendChild(gradeHeader);
            
            const popHeader = document.createElement('th');
            popHeader.textContent = 'Population';
            popHeader.style.textAlign = 'right';
            popHeader.style.padding = '5px';
            headerRow.appendChild(popHeader);
            
            thead.appendChild(headerRow);
            popTable.appendChild(thead);
            
            // Table body
            const tbody = document.createElement('tbody');
            
            for (const [grade, pop] of Object.entries(psaData.popData)) {
                const row = document.createElement('tr');
                
                const gradeCell = document.createElement('td');
                gradeCell.textContent = grade;
                gradeCell.style.padding = '5px';
                row.appendChild(gradeCell);
                
                const popCell = document.createElement('td');
                popCell.textContent = pop;
                popCell.style.textAlign = 'right';
                popCell.style.padding = '5px';
                row.appendChild(popCell);
                
                tbody.appendChild(row);
            }
            
            popTable.appendChild(tbody);
            popSection.appendChild(popTable);
            container.appendChild(popSection);
        }
        
        // Add footer with links and cache controls
        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.marginTop = '15px';
        
        // Left side: Cache controls
        const cacheControls = document.createElement('div');
        
        // Create refresh button
        const refreshButton = document.createElement('button');
        refreshButton.textContent = '🔄 Refresh';
        refreshButton.title = 'Refresh data from PSA';
        refreshButton.style.fontSize = '12px';
        refreshButton.style.padding = '3px 8px';
        refreshButton.style.marginRight = '8px';
        refreshButton.style.backgroundColor = '#f0f0f0';
        refreshButton.style.border = '1px solid #ccc';
        refreshButton.style.borderRadius = '3px';
        refreshButton.style.cursor = 'pointer';
        refreshButton.addEventListener('click', function() {
            // Remove from cache and fetch fresh data
            CacheManager.removeData(psaData.certNumber);
            fetchPSAData(psaData.certNumber);
        });
        
        // Create cache info/settings dropdown
        const cacheInfoButton = document.createElement('button');
        cacheInfoButton.textContent = '⚙️ Cache';
        cacheInfoButton.title = 'Cache settings';
        cacheInfoButton.style.fontSize = '12px';
        cacheInfoButton.style.padding = '3px 8px';
        cacheInfoButton.style.backgroundColor = '#f0f0f0';
        cacheInfoButton.style.border = '1px solid #ccc';
        cacheInfoButton.style.borderRadius = '3px';
        cacheInfoButton.style.cursor = 'pointer';
        
        // Cache dropdown menu
        const cacheDropdown = document.createElement('div');
        cacheDropdown.style.position = 'absolute';
        cacheDropdown.style.backgroundColor = 'white';
        cacheDropdown.style.border = '1px solid #ccc';
        cacheDropdown.style.borderRadius = '3px';
        cacheDropdown.style.padding = '8px';
        cacheDropdown.style.marginTop = '5px';
        cacheDropdown.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        cacheDropdown.style.zIndex = '1000';
        cacheDropdown.style.display = 'none';
        
        // Add cache info
        if (psaData._fromCache) {
            const cacheTimestamp = new Date(psaData._cacheTimestamp).toLocaleString();
            const cacheExpiration = new Date(psaData._cacheExpiration).toLocaleString();
            
            const cacheInfo = document.createElement('div');
            cacheInfo.style.marginBottom = '8px';
            cacheInfo.style.fontSize = '12px';
            cacheInfo.innerHTML = `
                <div><strong>Cached:</strong> ${cacheTimestamp}</div>
                <div><strong>Expires:</strong> ${cacheExpiration}</div>
            `;
            cacheDropdown.appendChild(cacheInfo);
        }
        
        // Add clear cache button
        const clearCacheButton = document.createElement('button');
        clearCacheButton.textContent = 'Clear All Cache';
        clearCacheButton.style.width = '100%';
        clearCacheButton.style.padding = '5px';
        clearCacheButton.style.marginTop = '5px';
        clearCacheButton.style.cursor = 'pointer';
        clearCacheButton.addEventListener('click', function() {
            if (confirm('Are you sure you want to clear all cached PSA data?')) {
                CacheManager.clearAllData();
                alert('Cache cleared successfully');
                cacheDropdown.style.display = 'none';
            }
        });
        cacheDropdown.appendChild(clearCacheButton);
        
        // Toggle dropdown
        cacheInfoButton.addEventListener('click', function(e) {
            e.stopPropagation();
            const isVisible = cacheDropdown.style.display === 'block';
            cacheDropdown.style.display = isVisible ? 'none' : 'block';
        });
        
        // Close dropdown when clicking elsewhere
        document.addEventListener('click', function() {
            cacheDropdown.style.display = 'none';
        });
        
        cacheDropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        
        // Add buttons to cache controls
        cacheControls.appendChild(refreshButton);
        cacheControls.appendChild(cacheInfoButton);
        cacheControls.appendChild(cacheDropdown);
        footer.appendChild(cacheControls);
        
        // Right side: PSA website link
        const psaLink = document.createElement('a');
        psaLink.href = `https://www.psacard.com/cert/${psaData.certNumber}/psa`;
        psaLink.textContent = 'View on PSA Website';
        psaLink.target = '_blank';
        psaLink.style.color = '#0654ba';
        footer.appendChild(psaLink);
        
        container.appendChild(footer);
        
        // Insert the container into the page
        insertPSADataContainer(container);
        
        // Compare with eBay listing price
        compareWithListingPrice();
    }
    
    function displayError(errorMessage) {
        // Remove loading indicator if it exists
        const loadingIndicator = document.getElementById('psa-data-loading');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
        
        // Create error message container
        const errorContainer = document.createElement('div');
        errorContainer.id = 'psa-data-error';
        errorContainer.style.border = '1px solid #e5e5e5';
        errorContainer.style.borderRadius = '4px';
        errorContainer.style.padding = '15px';
        errorContainer.style.marginTop = '15px';
        errorContainer.style.backgroundColor = '#fff0f0';
        errorContainer.style.color = '#d8000c';
        
        const errorText = document.createElement('div');
        errorText.textContent = errorMessage;
        errorContainer.appendChild(errorText);
        
        // Add retry button
        const retryButton = document.createElement('button');
        retryButton.textContent = 'Retry';
        retryButton.style.marginTop = '10px';
        retryButton.style.padding = '5px 10px';
        retryButton.style.cursor = 'pointer';
        retryButton.addEventListener('click', function() {
            errorContainer.remove();
            initScript();
        });
        errorContainer.appendChild(retryButton);
        
        // Insert the container into the page
        insertPSADataContainer(errorContainer);
    }

    function createLoadingIndicator() {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'psa-data-loading';
        loadingDiv.style.border = '1px solid #e5e5e5';
        loadingDiv.style.borderRadius = '4px';
        loadingDiv.style.padding = '15px';
        loadingDiv.style.marginTop = '15px';
        loadingDiv.style.backgroundColor = '#f8f8f8';
        loadingDiv.style.textAlign = 'center';
        
        const loadingText = document.createElement('div');
        loadingText.textContent = 'Loading PSA data...';
        loadingText.style.marginBottom = '10px';
        loadingDiv.appendChild(loadingText);
        
        const spinner = document.createElement('div');
        spinner.style.display = 'inline-block';
        spinner.style.width = '20px';
        spinner.style.height = '20px';
        spinner.style.border = '3px solid rgba(0, 0, 0, 0.1)';
        spinner.style.borderRadius = '50%';
        spinner.style.borderTop = '3px solid #3498db';
        spinner.style.animation = 'spin 1s linear infinite';
        loadingDiv.appendChild(spinner);
        
        // Add keyframe animation for spinner
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        
        return loadingDiv;
    }

    function insertPSADataContainer(container) {
        // Find a good location to insert the PSA data
        // Options in order of preference:
        // 1. After the price section
        // 2. After the item condition section
        // 3. At the end of the right summary panel
        
        const priceSection = document.querySelector('.x-price-section');
        const itemCondition = document.querySelector('.x-item-condition');
        const rightSummaryPanel = document.querySelector('#RightSummaryPanel');
        
        // Remove any existing PSA data container
        const existingContainer = document.getElementById('psa-data-container') || 
                                 document.getElementById('psa-data-loading') || 
                                 document.getElementById('psa-data-error');
        if (existingContainer) {
            existingContainer.remove();
        }
        
        if (priceSection) {
            priceSection.parentNode.insertBefore(container, priceSection.nextSibling);
        } else if (itemCondition) {
            itemCondition.parentNode.insertBefore(container, itemCondition.nextSibling);
        } else if (rightSummaryPanel) {
            rightSummaryPanel.appendChild(container);
        } else {
            // If all else fails, add it to the body
            document.body.appendChild(container);
        }
    }

    function addManualCertEntryButton() {
        // Create a more informative container
        const container = document.createElement('div');
        container.id = 'psa-manual-entry';
        container.style.marginTop = '15px';
        container.style.padding = '15px';
        container.style.border = '1px solid #e5e5e5';
        container.style.borderRadius = '4px';
        container.style.backgroundColor = '#f8f8f8';
        container.style.textAlign = 'center';
        
        // Add PSA logo from hosted image
        const psaLogo = document.createElement('img');
        // Use the hosted PSA logo image
        psaLogo.src = 'https://cconnect.s3.amazonaws.com/wp-content/uploads/2025/08/605205-1024x394.png';
        psaLogo.alt = 'PSA Logo';
        psaLogo.style.height = '20px';
        psaLogo.style.marginBottom = '10px';
        psaLogo.onerror = function() {
            // Fallback to original PSA website image if hosted image fails to load
            console.log('Hosted PSA logo failed to load, using fallback');
            this.src = 'https://www.psacard.com/images/logo-psa.svg';
        };
        container.appendChild(psaLogo);
        
        // Add information text
        const infoText = document.createElement('p');
        infoText.textContent = 'This appears to be a PSA graded item, but the certification number could not be automatically detected.';
        infoText.style.margin = '10px 0';
        infoText.style.fontSize = '14px';
        container.appendChild(infoText);
        
        // Add input field for better UX than a prompt
        const inputContainer = document.createElement('div');
        inputContainer.style.display = 'flex';
        inputContainer.style.justifyContent = 'center';
        inputContainer.style.alignItems = 'center';
        inputContainer.style.marginTop = '10px';
        
        const inputField = document.createElement('input');
        inputField.type = 'text';
        inputField.placeholder = 'Enter PSA certification number';
        inputField.style.padding = '8px 10px';
        inputField.style.border = '1px solid #ccc';
        inputField.style.borderRadius = '3px';
        inputField.style.marginRight = '10px';
        inputField.style.width = '200px';
        
        // Add validation for input field
        inputField.addEventListener('input', function() {
            // Remove non-numeric characters
            this.value = this.value.replace(/[^0-9]/g, '');
        });
        
        // Allow pressing Enter to submit
        inputField.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                submitCertNumber();
            }
        });
        
        const button = document.createElement('button');
        button.textContent = 'Look Up';
        button.style.padding = '8px 15px';
        button.style.cursor = 'pointer';
        button.style.backgroundColor = '#0654ba';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '3px';
        button.style.fontWeight = 'bold';
        
        // Add hover effect
        button.addEventListener('mouseover', function() {
            this.style.backgroundColor = '#0043a7';
        });
        
        button.addEventListener('mouseout', function() {
            this.style.backgroundColor = '#0654ba';
        });
        
        function submitCertNumber() {
            const certNumber = inputField.value.trim();
            if (certNumber && /^\d{8,}$/.test(certNumber)) {
                fetchPSAData(certNumber);
            } else {
                // Show inline error instead of alert
                inputField.style.border = '1px solid #d8000c';
                
                const errorMsg = document.getElementById('psa-cert-error');
                if (!errorMsg) {
                    const newErrorMsg = document.createElement('div');
                    newErrorMsg.id = 'psa-cert-error';
                    newErrorMsg.textContent = 'Please enter a valid PSA certification number (at least 8 digits)';
                    newErrorMsg.style.color = '#d8000c';
                    newErrorMsg.style.fontSize = '12px';
                    newErrorMsg.style.marginTop = '5px';
                    inputContainer.appendChild(newErrorMsg);
                }
            }
        }
        
        button.addEventListener('click', submitCertNumber);
        
        inputContainer.appendChild(inputField);
        inputContainer.appendChild(button);
        container.appendChild(inputContainer);
        
        // Add help text
        const helpText = document.createElement('p');
        helpText.innerHTML = 'The PSA certification number is typically 8-10 digits and can be found on the PSA label.';
        helpText.style.margin = '10px 0 0 0';
        helpText.style.fontSize = '12px';
        helpText.style.color = '#666';
        container.appendChild(helpText);
        
        insertPSADataContainer(container);
    }

    function compareWithListingPrice() {
        // Get the current listing price
        const priceElement = document.querySelector('.x-price-primary') || 
                            document.querySelector('[itemprop="price"]') ||
                            document.querySelector('.price');
        if (!priceElement) {
            console.log('Could not find listing price element');
            return;
        }
        
        const priceText = priceElement.textContent.trim();
        // Handle different currency formats ($1,234.56 or 1.234,56 € etc.)
        const priceMatch = priceText.match(/[\d,.]+/);
        
        if (!priceMatch) {
            console.log('Could not extract price from text:', priceText);
            return;
        }
        
        // Normalize price string by removing all non-digit characters except the last period or comma
        let priceStr = priceMatch[0];
        // Determine if the decimal separator is a period or comma based on the last one in the string
        const lastPeriodIndex = priceStr.lastIndexOf('.');
        const lastCommaIndex = priceStr.lastIndexOf(',');
        
        let listingPrice;
        if (lastPeriodIndex > lastCommaIndex) {
            // Format like $1,234.56 (US/UK style)
            listingPrice = parseFloat(priceStr.replace(/,/g, ''));
        } else if (lastCommaIndex > lastPeriodIndex) {
            // Format like 1.234,56 € (European style)
            listingPrice = parseFloat(priceStr.replace(/\./g, '').replace(',', '.'));
        } else {
            // No decimal separator, just parse as is
            listingPrice = parseFloat(priceStr);
        }
        
        if (isNaN(listingPrice)) {
            console.log('Failed to parse listing price:', priceStr);
            return;
        }
        
        console.log('Listing price:', listingPrice);
        
        // Get the PSA price data container
        const psaDataContainer = document.getElementById('psa-data-container');
        if (!psaDataContainer) {
            console.log('PSA data container not found');
            return;
        }
        
        // Try multiple methods to get the current grade
        let currentGrade = null;
        
        // Method 1: Look in item specifics
        const gradeElements = document.querySelectorAll('.ux-labels-values--grade .ux-labels-values__values-content div span');
        for (const element of gradeElements) {
            const text = element.textContent.trim();
            const gradeMatch = text.match(/PSA\s+(\d+)/i) || text.match(/(\d+)/);
            if (gradeMatch && gradeMatch[1]) {
                currentGrade = gradeMatch[1];
                break;
            }
        }
        
        // Method 2: Look for "Graded - PSA" text
        if (!currentGrade) {
            const textSpans = document.querySelectorAll('.ux-textspans');
            for (const element of textSpans) {
                if (element.textContent.includes('Graded - PSA') || element.textContent.includes('PSA')) {
                    const text = element.textContent.trim();
                    const gradeMatch = text.match(/PSA\s+(\d+)/i);
                    if (gradeMatch && gradeMatch[1]) {
                        currentGrade = gradeMatch[1];
                        break;
                    }
                }
            }
        }
        
        // Method 3: Look in the title
        if (!currentGrade) {
            const titleElement = document.querySelector('.x-item-title__mainTitle span');
            if (titleElement) {
                const titleText = titleElement.textContent;
                const gradeMatch = titleText.match(/PSA\s+(\d+)/i);
                if (gradeMatch && gradeMatch[1]) {
                    currentGrade = gradeMatch[1];
                }
            }
        }
        
        // Method 4: Extract from PSA data container if we already have the grade
        if (!currentGrade) {
            const gradeText = psaDataContainer.textContent;
            const gradeMatch = gradeText.match(/Grade:\s*PSA\s+(\d+)/i) || 
                              gradeText.match(/Grade:\s*(\d+)/i);
            if (gradeMatch && gradeMatch[1]) {
                currentGrade = gradeMatch[1];
            }
        }
        
        if (!currentGrade) {
            console.log('Could not determine card grade');
            return;
        }
        
        console.log('Current grade:', currentGrade);
        
        // Find the PSA price for the current grade
        const priceRows = psaDataContainer.querySelectorAll('table tr');
        let psaPrice = null;
        
        for (const row of priceRows) {
            const cells = row.querySelectorAll('td, th');
            if (cells.length < 2) continue;
            
            const gradeCell = cells[0];
            const priceCell = cells[1];
            
            if (gradeCell.textContent.includes(currentGrade)) {
                const priceCellText = priceCell.textContent.trim();
                // Handle different currency formats
                const psaPriceMatch = priceCellText.match(/[\d,.]+/);
                
                if (psaPriceMatch) {
                    // Apply the same parsing logic as for the listing price
                    const priceStr = psaPriceMatch[0];
                    const lastPeriodIndex = priceStr.lastIndexOf('.');
                    const lastCommaIndex = priceStr.lastIndexOf(',');
                    
                    if (lastPeriodIndex > lastCommaIndex) {
                        psaPrice = parseFloat(priceStr.replace(/,/g, ''));
                    } else if (lastCommaIndex > lastPeriodIndex) {
                        psaPrice = parseFloat(priceStr.replace(/\./g, '').replace(',', '.'));
                    } else {
                        psaPrice = parseFloat(priceStr);
                    }
                    
                    break;
                }
            }
        }
        
        if (psaPrice === null || isNaN(psaPrice)) {
            console.log('Could not determine PSA price for grade', currentGrade);
            return;
        }
        
        console.log('PSA price for grade', currentGrade, ':', psaPrice);
        
        // Create price comparison section
        const comparisonSection = document.createElement('div');
        comparisonSection.style.marginTop = '15px';
        comparisonSection.style.padding = '15px';
        comparisonSection.style.border = '1px solid #e5e5e5';
        comparisonSection.style.borderRadius = '4px';
        comparisonSection.style.backgroundColor = '#f8f8f8';
        
        const comparisonTitle = document.createElement('div');
        comparisonTitle.textContent = 'Price Comparison:';
        comparisonTitle.style.fontWeight = 'bold';
        comparisonTitle.style.marginBottom = '10px';
        comparisonTitle.style.fontSize = '16px';
        comparisonSection.appendChild(comparisonTitle);
        
        // Create a table for better formatting
        const comparisonTable = document.createElement('table');
        comparisonTable.style.width = '100%';
        comparisonTable.style.borderCollapse = 'collapse';
        
        // eBay price row
        const ebayRow = document.createElement('tr');
        
        const ebayLabelCell = document.createElement('td');
        ebayLabelCell.textContent = 'eBay Listing Price:';
        ebayLabelCell.style.padding = '5px';
        ebayLabelCell.style.textAlign = 'left';
        ebayRow.appendChild(ebayLabelCell);
        
        const ebayPriceCell = document.createElement('td');
        ebayPriceCell.textContent = `$${listingPrice.toFixed(2)}`;
        ebayPriceCell.style.padding = '5px';
        ebayPriceCell.style.textAlign = 'right';
        ebayPriceCell.style.fontWeight = 'bold';
        ebayRow.appendChild(ebayPriceCell);
        
        comparisonTable.appendChild(ebayRow);
        
        // PSA price row
        const psaRow = document.createElement('tr');
        
        const psaLabelCell = document.createElement('td');
        psaLabelCell.textContent = `PSA Estimated Value (Grade ${currentGrade}):`;
        psaLabelCell.style.padding = '5px';
        psaLabelCell.style.textAlign = 'left';
        psaRow.appendChild(psaLabelCell);
        
        const psaPriceCell = document.createElement('td');
        psaPriceCell.textContent = `$${psaPrice.toFixed(2)}`;
        psaPriceCell.style.padding = '5px';
        psaPriceCell.style.textAlign = 'right';
        psaPriceCell.style.fontWeight = 'bold';
        psaRow.appendChild(psaPriceCell);
        
        comparisonTable.appendChild(psaRow);
        
        // Add separator row
        const separatorRow = document.createElement('tr');
        const separatorCell = document.createElement('td');
        separatorCell.colSpan = 2;
        separatorCell.style.borderBottom = '1px solid #ccc';
        separatorCell.style.padding = '5px 0';
        separatorRow.appendChild(separatorCell);
        comparisonTable.appendChild(separatorRow);
        
        // Difference row
        const difference = listingPrice - psaPrice;
        const percentDiff = (difference / psaPrice) * 100;
        
        const differenceRow = document.createElement('tr');
        
        const differenceLabelCell = document.createElement('td');
        differenceLabelCell.textContent = 'Difference:';
        differenceLabelCell.style.padding = '5px';
        differenceLabelCell.style.textAlign = 'left';
        differenceLabelCell.style.fontWeight = 'bold';
        differenceRow.appendChild(differenceLabelCell);
        
        const differenceValueCell = document.createElement('td');
        differenceValueCell.textContent = `$${Math.abs(difference).toFixed(2)} (${Math.abs(percentDiff).toFixed(1)}%)`;
        differenceValueCell.style.padding = '5px';
        differenceValueCell.style.textAlign = 'right';
        differenceValueCell.style.fontWeight = 'bold';
        
        if (difference > 0) {
            differenceValueCell.style.color = '#d8000c';
        } else if (difference < 0) {
            differenceValueCell.style.color = '#4F8A10';
        }
        
        differenceRow.appendChild(differenceValueCell);
        comparisonTable.appendChild(differenceRow);
        
        comparisonSection.appendChild(comparisonTable);
        
        // Add recommendation text
        const recommendationDiv = document.createElement('div');
        recommendationDiv.style.marginTop = '10px';
        recommendationDiv.style.fontSize = '14px';
        
        if (difference > 0) {
            if (percentDiff > 20) {
                recommendationDiv.textContent = 'This listing is significantly overpriced compared to PSA estimated value.';
                recommendationDiv.style.color = '#d8000c';
            } else if (percentDiff > 5) {
                recommendationDiv.textContent = 'This listing is moderately overpriced compared to PSA estimated value.';
                recommendationDiv.style.color = '#e68a00';
            } else {
                recommendationDiv.textContent = 'This listing is slightly higher than PSA estimated value.';
                recommendationDiv.style.color = '#666';
            }
        } else if (difference < 0) {
            if (percentDiff < -20) {
                recommendationDiv.textContent = 'This listing is significantly underpriced compared to PSA estimated value.';
                recommendationDiv.style.color = '#4F8A10';
            } else if (percentDiff < -5) {
                recommendationDiv.textContent = 'This listing is moderately underpriced compared to PSA estimated value.';
                recommendationDiv.style.color = '#4F8A10';
            } else {
                recommendationDiv.textContent = 'This listing is slightly lower than PSA estimated value.';
                recommendationDiv.style.color = '#666';
            }
        } else {
            recommendationDiv.textContent = 'This listing matches the PSA estimated value exactly.';
            recommendationDiv.style.color = '#666';
        }
        
        comparisonSection.appendChild(recommendationDiv);
        
        // Add disclaimer
        const disclaimerDiv = document.createElement('div');
        disclaimerDiv.textContent = 'Note: PSA values are estimates based on recent sales data and may vary.';
        disclaimerDiv.style.marginTop = '10px';
        disclaimerDiv.style.fontSize = '12px';
        disclaimerDiv.style.fontStyle = 'italic';
        disclaimerDiv.style.color = '#666';
        comparisonSection.appendChild(disclaimerDiv);
        
        // Add the comparison section to the PSA data container
        psaDataContainer.appendChild(comparisonSection);
    }
})();
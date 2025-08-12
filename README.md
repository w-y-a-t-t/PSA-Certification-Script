# PSA Certification Script

A browser userscript that enhances eBay listings for PSA-graded sports cards by fetching and displaying PSA certification data and price estimates.

## Features

- **Automatic Detection**: Intelligently finds PSA certification numbers on eBay listings
- **Smart Data Extraction**: Fetches and parses card data from the PSA website
- **Comprehensive Information**: Displays card details, grade, population data, and price estimates
- **Price Comparison**: Analyzes the eBay listing price against PSA's estimated value
- **Visual Recommendations**: Color-coded indicators show if a listing is overpriced or a good deal
- **Manual Entry Option**: Allows entry of PSA certification numbers if automatic detection fails
- **Direct PSA Link**: Provides a link to the official PSA certification page
- **Data Caching**: Stores PSA data locally to improve performance and reduce server load
- **Modal Handling**: Automatically clicks "Check PSA data" buttons and extracts information
- **Customizable Settings**: Configure cache duration and other preferences

## Installation

1. Install a userscript manager extension for your browser:
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/)

2. Install the script by:
   - Opening the raw `psa_certification.user.js` file and clicking "Install" when prompted by your userscript manager
   - Or copying the content of `psa_certification.user.js` and creating a new script in your userscript manager

## Usage

### Automatic Detection

1. Browse to any eBay listing for a PSA-graded card
2. The script will automatically:
   - Detect the PSA certification number from various locations on the page
   - If needed, click on "Check PSA data" buttons to reveal the certification number
   - Fetch data from the PSA website (or use cached data if available)
   - Display the information in a panel on the eBay page
   - Compare the eBay listing price with PSA's estimated value

### Manual Entry

If the script cannot automatically detect the PSA certification number:

1. A "Look Up" button will appear in a PSA data panel
2. Enter the PSA certification number (typically 8-10 digits found on the PSA label)
3. Click "Look Up" or press Enter
4. The script will fetch and display the PSA data

### Cache Management

The script includes a caching system to improve performance:

1. PSA data is cached locally for 7 days by default
2. Cached items are indicated with a "Cached" badge
3. Use the "🔄 Refresh" button to force a fresh fetch from PSA
4. Click the "⚙️ Cache" button to:
   - View when data was cached and when it expires
   - Clear all cached data

## How It Works

The script performs several sophisticated operations:

1. **Certification Number Detection**:
   - Searches item specifics sections for PSA certification numbers
   - Automatically clicks "Check PSA data" buttons to reveal hidden certification numbers
   - Examines title, description, and other page elements
   - Looks for various formats of certification numbers in key-value pairs

2. **Data Retrieval and Caching**:
   - First checks local cache for previously fetched data
   - If not in cache, makes a request to the PSA website using the certification number
   - Uses cross-origin requests to bypass same-origin policy restrictions
   - Stores fetched data in cache for future use (with configurable expiration)

3. **Data Extraction**:
   - Parses the HTML response from PSA
   - Extracts card details, grade, population data, and price estimates
   - Uses multiple selectors and fallback methods to handle different HTML structures
   - Specifically targets population data in links with format shown in the example

4. **Price Analysis**:
   - Compares the eBay listing price with PSA's estimated value
   - Calculates percentage difference
   - Provides recommendations based on price discrepancy (significantly overpriced, good deal, etc.)

5. **User Interface**:
   - Displays information in a clean, formatted panel
   - Uses color-coding to highlight price differences
   - Provides detailed price comparison with recommendations
   - Includes cache management controls and status indicators

## Advanced Features

### Certification Number Detection

- **Multiple Detection Methods**: Uses several techniques to find certification numbers
- **Modal Interaction**: Automatically clicks "Check PSA data" buttons and extracts information
- **Context-Aware Search**: Looks for certification numbers in relevant contexts (near PSA mentions)

### Data Handling

- **Currency Format Handling**: Properly parses different price formats (US, European)
- **Grade Detection**: Intelligently identifies the card's grade from multiple sources
- **Population Data Extraction**: Specifically targets population counts in various formats
- **Card Name Recognition**: Identifies card names in uppercase text and other formats

### Caching System

- **Local Storage**: Uses Tampermonkey's storage API for persistent caching
- **Expiration Control**: Automatically expires cached data after a configurable period (default: 7 days)
- **Size Management**: Limits cache size and removes oldest entries when needed
- **User Controls**: Provides UI for viewing cache status and clearing cache

### User Interface

- **Responsive Design**: Works well on different screen sizes and eBay layouts
- **Visual Indicators**: Shows cached status, price comparisons, and recommendations
- **Error Handling**: Provides helpful feedback if data cannot be retrieved
- **Modal Management**: Automatically closes modals after extracting data

## Troubleshooting

- **No PSA Data Appears**: The script may not have found a valid certification number. Use the manual entry option.
- **Price Comparison Missing**: The script might not be able to determine the card's grade or match it with PSA data.
- **Data Looks Incorrect**: PSA's website structure may have changed. Try using the "Refresh" button to bypass the cache.
- **Script Not Working**: Check the browser console for error messages. The script includes extensive logging.

## Limitations

- The script relies on the structure of eBay and PSA websites, which may change over time
- Price estimates from PSA may not always be available for all cards
- The script requires permission to make cross-origin requests to the PSA website
- Some eBay listings may use non-standard formats that the script cannot parse

## Privacy and Security

- This script only accesses data on eBay listings and the PSA website
- Cached data is stored locally in your browser and is not shared
- No data is collected, stored, or transmitted to any third parties
- The script runs entirely in your browser

## Configuration

Advanced users can modify these settings at the top of the script:

```javascript
// Cache configuration
const CACHE_CONFIG = {
    // Cache expiration time in milliseconds (default: 7 days)
    expirationTime: 7 * 24 * 60 * 60 * 1000,
    
    // Maximum number of items to keep in cache
    maxItems: 100,
    
    // Cache key prefix
    keyPrefix: 'psa_cert_data_'
};
```

## Contributing

Feel free to submit issues or pull requests if you find bugs or have suggestions for improvements. Areas for potential enhancement include:

- Additional detection methods for certification numbers
- Support for other grading companies (BGS, SGC, etc.)
- Enhanced price history and trend analysis
- Mobile optimization
- User preferences interface

## License

This project is open source and available under the MIT License.
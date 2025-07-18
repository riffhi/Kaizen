/**
 * Appwrite Database Processing Script
 * Reads existing data from an Appwrite collection and re-processes/updates it.
 * This script addresses the 'ENOENT' error by fetching data directly from Appwrite
 * instead of a local CSV file.
 */
// Corrected path to .env file: assumes .env is two directories up from 'scripts'
const path = require('path'); // Import the path module

// Determine the absolute path to the .env file
// Adjusted path based on your clarification: .env is one level up in 'anomaly-engine' folder
const envPath = path.resolve(__dirname, '../.env');

console.log(`Attempting to load .env from: ${envPath}`);
require('dotenv').config({ path: envPath });

const { Client, Databases, Query } = require('node-appwrite'); // Added Query for fetching documents

async function seedDatabase() { // Keeping the name 'seedDatabase' but functionality is now 'processAppwriteData'
  console.log('Starting Appwrite data processing...');

  // --- DEBUGGING: Log environment variables ---
  console.log('Environment Variables Check:');
  console.log('APPWRITE_ENDPOINT:', process.env.APPWRITE_ENDPOINT);
  console.log('APPWRITE_PROJECT_ID:', process.env.APPWRITE_PROJECT_ID);
  console.log('APPWRITE_API_KEY:', process.env.APPWRITE_API_KEY);
  console.log('APPWRITE_DATABASE_ID:', process.env.APPWRITE_DATABASE_ID);
  console.log('APPWRITE_MEDICINE_COLLECTION_ID:', process.env.APPWRITE_MEDICINE_COLLECTION_ID); // Added for clarity
  console.log('---------------------------------');
  // --- END DEBUGGING ---

  // Check if essential environment variables are defined
  if (!process.env.APPWRITE_ENDPOINT || !process.env.APPWRITE_PROJECT_ID || !process.env.APPWRITE_API_KEY || !process.env.APPWRITE_DATABASE_ID || !process.env.APPWRITE_MEDICINE_COLLECTION_ID) {
    console.error('Error: One or more required Appwrite environment variables are missing or undefined.');
    console.error('Please ensure APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID, and APPWRITE_MEDICINE_COLLECTION_ID are set in your .env file.');
    process.exit(1); // Exit the script if critical variables are missing
  }

  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  const databaseId = process.env.APPWRITE_DATABASE_ID;
  // Using the environment variable for collection ID
  const collectionId = process.env.APPWRITE_MEDICINE_COLLECTION_ID;

  let records = [];
  let hasMore = true;
  let cursor = null; // For pagination in case of many documents

  console.log(`Fetching existing records from Appwrite collection '${collectionId}'...`);

  try {
    // Fetch all documents from the 'medicines' collection using pagination
    while (hasMore) {
      const queries = [Query.limit(100)]; // Fetch up to 100 documents at a time
      if (cursor) {
        queries.push(Query.cursorAfter(cursor)); // Use cursor for subsequent pages
      }

      const response = await databases.listDocuments(
        databaseId,
        collectionId,
        queries
      );

      records = records.concat(response.documents);
      hasMore = response.documents.length === 100; // If 100 documents were returned, there might be more
      if (hasMore) {
        cursor = response.documents[response.documents.length - 1].$id; // Set cursor to the last document's ID for the next page
      }
    }

    console.log(`Found ${records.length} existing records in Appwrite to process...`);

    if (records.length === 0) {
      console.log('No records found in the Appwrite collection to process. Exiting.');
      return;
    }

    // --- Helper Functions for Calculations (for demonstration purposes, not saved to medicine doc) ---
    /**
     * Calculates the current decline rate of stock based on recent history.
     * @param {Array<number>} stockHistory - Array of historical stock levels (most recent first).
     * @returns {number|null} The average daily decline rate, or null if insufficient data.
     */
    const calculateCurrentDeclineRate = (stockHistory) => {
      if (!stockHistory || stockHistory.length < 3) {
        return null; // Not enough data to calculate a meaningful decline rate
      }
      // Assuming stockHistory is ordered from most recent to oldest
      const recent = stockHistory.slice(0, 3); // Take the 3 most recent points
      const decline = recent[0] - recent[2];
      const periods = 2;
      return decline / periods;
    };

    /**
     * Calculates the projected stockout date based on current stock and daily consumption.
     * @param {number} currentStock - The current stock level.
     * @param {number} dailyConsumption - The average daily consumption rate.
     * @returns {string|null} The projected stockout date in ISO string format, or null if not applicable.
     */
    const calculateProjectedStockoutDate = (currentStock, dailyConsumption) => {
      if (currentStock <= 0 || dailyConsumption <= 0) {
        return null; // Already out of stock or no consumption
      }
      const daysRemaining = currentStock / dailyConsumption;
      const stockoutDate = new Date();
      stockoutDate.setDate(stockoutDate.getDate() + Math.floor(daysRemaining));
      return stockoutDate.toISOString();
    };
    // --- End Helper Functions ---


    for (const record of records) {
      try {
        // These calculations are for demonstration *within this script* if needed.
        // They are NOT saved to the medicine document by this script, as they are
        // derived metrics best handled by the anomaly detection engine.
        // const currentDeclineRate = calculateCurrentDeclineRate(record.stockHistory);
        // const projectedStockoutDate = calculateProjectedStockoutDate(record.currentStock, record.dailyConsumption);

        // console.log(`Medicine: ${record.medicineName}, Decline Rate: ${currentDeclineRate}, Stockout Date: ${projectedStockoutDate}`);

        // Extract relevant fields from the fetched Appwrite document.
        // Ensure only attributes defined in your Appwrite Medicine Collection schema are included.
        const documentData = {
          medicineID: record.medicineID,
          medicineName: record.medicineName,
          genericName: record.genericName,
          company: record.company,
          disease: record.disease,
          currentStock: record.currentStock,
          currentPrice: record.currentPrice,
          location: record.location,
          supplier: record.supplier,
          criticalThreshold: record.criticalThreshold,
          averageMarketPrice: record.averageMarketPrice,
          dailyConsumption: record.dailyConsumption,
          stockHistory: record.stockHistory,
          priceHistory: record.priceHistory,
          supplierDelay: record.supplierDelay,
          lastUpdatedAt: record.lastUpdatedAt,
          description: record.description || 'No description provided.',
          causesOfShortage: record.causesOfShortage || '',
          // REMOVED: projectedStockoutDate as it's an unknown attribute for the medicine collection
          // projectedStockoutDate: record.projectedStockoutDate || null,
        };

        // Update the existing document using its $id.
        await databases.updateDocument(
          databaseId,
          collectionId,
          record.$id, // Use the existing document's $id to update it
          documentData
        );
        console.log(`Successfully processed and updated document for ${record.medicineName} (ID: ${record.$id})`);
      } catch (error) {
        // Handle specific Appwrite errors during the update operation
        if (error.code === 404) {
          console.error(`Document with ID ${record.$id} not found for ${record.medicineName}. Skipping update.`);
        } else {
          console.error(`Failed to process/update document for ${record.medicineName} (ID: ${record.$id}):`, error);
        }
      }
    }

    console.log('Appwrite data processing complete!');

  } catch (fetchError) {
    console.error('Error fetching documents from Appwrite:', fetchError);
    process.exit(1); // Exit if there's an error fetching initial documents
  }
}

seedDatabase();

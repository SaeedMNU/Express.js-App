var express = require("express");
var path = require("path");
var app = express();
var propertiesReader = require("properties-reader");
var propertiesPath = path.resolve(__dirname, "conf/db.properties");
var properties = propertiesReader(propertiesPath);

app.use(express.json());

// Middleware: Log incoming requests
app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    next();
});

// Middleware: Returns lesson images
app.use('/images', express.static(path.join(__dirname, 'static/images')));

var staticPath = path.join(__dirname, "static");
app.use(express.static(staticPath));

const { ObjectId } = require('mongodb');

let dbPprefix = properties.get("db.prefix");
let dbUsername = encodeURIComponent(properties.get("db.user"));
let dbPwd = encodeURIComponent(properties.get("db.pwd"));
let dbName = properties.get("db.dbName");
let dbUrl = properties.get("db.dbUrl");
let dbParams = properties.get("db.params");
const uri = dbPprefix + dbUsername + ":" + dbPwd + dbUrl + dbParams;

const { MongoClient, ServerApiVersion } = require("mongodb");
const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
let db = client.db(dbName);

// Middleware: sets `req.collection` for MongoDB collection access
app.param('collectionName', function (req, res, next, collectionName) {
    req.collection = db.collection(collectionName);
    return next();
});

// Endpoint to retrieve all lessons from the database collection "products"
app.get('/lessons', async function (req, res) {
    try {
        const lessons = await db.collection("products").find({}).toArray();
        res.json(lessons);
    } catch (err) {
        console.error("Error fetching lessons:", err);
        res.status(500).send("Error retrieving lessons from database.");
    }
});

// POST route to create an order in the specified collection
app.post('/collections/:collectionName', function (req, res, next) {
    // Ensure we are working with the "order" collection
    if (req.params.collectionName !== "order") {
        return res.status(400).send("Invalid collection name. Use 'order' for creating an order.");
    }

    // Validate the request body for required fields
    const { id, bookedSpaces, name, phoneNum } = req.body;
    if (!id || !bookedSpaces || !name || !phoneNum) {
        return res.status(400).send({ error: "All fields (id, bookedSpaces, name, phoneNum) are required." });
    }

    // Prepare the order document to be inserted
    const order = {
        id,
        bookedSpaces,
        name,
        phoneNum,
        fulfilled: false,
    };

    // Insert the document into the "order" collection
    req.collection.insertOne(order, function (err, results) {
        if (err) {
            return next(err);
        }
        res.send(results);
    });
});

app.put('/collections/products/:lessonId', async (req, res) => {
    const lessonId = req.params.lessonId;  // The ID passed in the URL
    try {
        // Find the lesson by its ID in the products collection
        const lesson = await db.collection('products').findOne({ _id: new ObjectId(lessonId) });

        if (!lesson) {
            return res.status(404).json({ message: "Lesson not found." });
        }

        // Search for unfulfilled orders that reference the lesson's 'id' field
        const unfulfilledOrders = await db.collection('order').find({
            id: lesson.id,   // Search by the 'id' field from the order collection
            fulfilled: false
        }).toArray();

        if (unfulfilledOrders.length === 0) {
            return res.status(404).json({ message: "No unfulfilled orders found for this lesson." });
        }

        // Loop through each unfulfilled order and deduct the bookedSpaces from the availableSpaces
        let newAvailableSpaces = lesson.availableSpaces;

        unfulfilledOrders.forEach((order) => {
            newAvailableSpaces -= order.bookedSpaces;
        });

        // Update the availableSpaces of the lesson
        const updateLessonResult = await db.collection('products').updateOne(
            { _id: new ObjectId(lessonId) },
            { $set: { availableSpaces: newAvailableSpaces } }
        );

        if (updateLessonResult.modifiedCount === 0) {
            return res.status(500).json({ message: "Failed to update lesson." });
        }

        // After successfully updating the lesson, mark the orders as fulfilled
        const updateOrdersResult = await db.collection('order').updateMany(
            { id: lesson.id, fulfilled: false },
            { $set: { fulfilled: true } }
        );

        if (updateOrdersResult.modifiedCount === 0) {
            return res.status(500).json({ message: "Failed to update orders." });
        }

        res.json({
            message: "Lesson and orders successfully updated.",
            newAvailableSpaces: newAvailableSpaces
        });
    } catch (error) {
        console.error("Error processing PUT request:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

// Middleware: 404 Error handling for API routes
app.use((req, res) => {
    res.status(404).send("Resource not found");
});

app.listen(3000, function () {
    console.log("App started on port 3000");
});

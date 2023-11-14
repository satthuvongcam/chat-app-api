const express = require('express')
const bodyParser = require('body-parser')
const mongoose = require('mongoose')
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy
const cors = require('cors')
const jwt = require('jsonwebtoken')
const User = require('./models/user')
const Message = require('./models/message')
const path = require('path')
const multer = require('multer')
const { Server } = require('socket.io')
const { createServer } = require('node:http')

const app = express()
const server = createServer(app)
const io = new Server(server)
const port = 8000

app.use('/files', express.static(path.join(__dirname, 'files')))
app.use(cors())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(passport.initialize())

mongoose
  .connect('mongodb+srv://truonglh:truong2003@cluster0.km28ljp.mongodb.net/')
  .then(() => {
    console.log('Connected to MongoDB')
  })
  .catch((err) => {
    console.log('Error connecting to MongoDB ', err)
  })

app.get('/', (req, res) => {
  res.send('Hello World!')
})

server.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})

// endpoint for registration of the user
app.post('/register', async (req, res) => {
  const { name, email, password, image } = req.body

  try {
    // create a new user object
    const newUser = new User({ name, email, password, image })

    // save the user to the db
    await newUser.save()

    res.status(200).json({ message: 'User registered successfully' })
  } catch (err) {
    console.log('Error registering the user ', err)
    res.status(500).json({ message: 'Error registering the user' })
  }
})

// Function to create a token for the user
const createToken = (userId) => {
  // Set the token payload
  const payload = {
    userId: userId,
  }

  // Generate the token with a secret key and expiration time
  const token = jwt.sign(payload, 'secret', { expiresIn: '1h' })
  return token
}

// endpoint for login in of that particular user
app.post('/login', async (req, res) => {
  const { email, password } = req.body

  try {
    // check if the email and password are provided
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required' })
    }

    // check for that user in the db
    const user = await User.findOne({ email })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    // conpare the provided password with the password in the db
    if (user.password !== password) {
      return res.status(404).json({ message: 'Incorrect password' })
    }

    const token = createToken(user._id)
    res.status(200).json({ token })
  } catch (err) {
    console.log('Error in login', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// endpoint to access all the users except the user who's currently logged in
app.get('/users/:userId', async (req, res) => {
  try {
    const loggedInUserId = req.params.userId
    console.log(loggedInUserId)

    const users = await User.find({ _id: { $ne: loggedInUserId } })
    res.status(200).json(users)
  } catch (err) {
    console.log('Error retrieving users', err)
    res.status(500).json({ message: 'Error retrieving users' })
  }
})

// endpoint to send a request to a user
app.post('/friend-request', async (req, res) => {
  const { currentUserId, selectedUserId } = req.body
  try {
    // Update the recepient of friend requests array
    await User.findByIdAndUpdate(selectedUserId, {
      $push: { friendRequests: currentUserId },
    })

    // Update the sender of đen requests array
    await User.findByIdAndUpdate(currentUserId, {
      $push: { sendFriendRequests: selectedUserId },
    })

    res.sendStatus(200)
  } catch (err) {
    res.sendStatus(500)
  }
})

// endpoint to show all the friend-requests of a particular user
app.get('/friend-request/:userId', async (req, res) => {
  try {
    console.log('Friend request')
    const { userId } = req.params

    // Fetch the user document based on the userId
    const user = await User.findById(userId)
      .populate('friendRequests', 'name email image') // reference to friendRequests and refill name, email, image from the user with ID in friendRequests
      .lean() // transform to object in JS
    const friendRequests = user.friendRequests
    res.json(friendRequests)
  } catch (err) {
    console.log('Err ', err)
    res.status(500).json({ message: 'Internal Server Error' })
  }
})

// endpoint to accept a friend-request of a particular person
app.post('/friend-request/accept', async (req, res) => {
  try {
    const { senderId, recepientId } = req.body
    // retrieve the documents of sender and the recipient
    const sender = await User.findById(senderId)
    const recepient = await User.findById(recepientId)

    sender.friends.push(recepientId)
    recepient.friends.push(senderId)

    recepient.friendRequests = recepient.friendRequests.filter(
      (request) => request.toString() !== senderId.toString()
    )

    sender.sendFriendRequests = sender.sendFriendRequests.filter(
      (request) => request.toString() !== recepientId.toString()
    )
    await sender.save()
    await recepient.save()
    res.status(200).json({ message: 'Friend Request accepted successfully' })
  } catch (err) {
    console.log('Err ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})
// endpoint to access all the friends of the logged in user
app.get('/accepted-friends/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const user = await User.findById(userId).populate(
      'friends',
      'name email image'
    )
    const acceptedFriends = user.friends
    res.json(acceptedFriends)
  } catch (err) {
    console.log('Error ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'files/') // Specify the desired destination folder
  },
  filename: function (req, file, cb) {
    // Generate a unique filename for the uploaded file
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  },
})

const upload = multer({ storage: storage })

// endpoint to post messages and store it in the be
app.post('/messages', upload.single('imageFile'), async (req, res) => {
  try {
    const { senderId, recepientId, messageType, messageText } = req.body
    const newMessage = new Message({
      senderId,
      recepientId,
      messageType,
      message: messageText,
      imageUrl: messageType === 'image' ? req.file.path : null,
      timeStamp: new Date(),
    })
    console.log('req body: ', req.body)
    console.log('New messages: ', newMessage)
    await newMessage.save()

    res.status(200).json({ newMessage })
  } catch (err) {
    console.log('Error ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// endpoint to get the userDetails to design the chat room header
app.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    // fetch the user data from the userId
    const recepientId = await User.findById(userId)
    res.json(recepientId)
  } catch (err) {
    console.log('Error ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// endpoint to fetch the message between two users in the chat room
app.get('/messages/:senderId/:recepientId', async (req, res) => {
  try {
    const { senderId, recepientId } = req.params

    const messages = await Message.find({
      $or: [
        { senderId: senderId, recepientId: recepientId },
        { senderId: recepientId, recepientId: senderId },
      ],
    }).populate('senderId', '_id name')

    res.json(messages)
  } catch (err) {
    console.log('Error ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// endpoint to delete the messages
app.post('/deleteMessages', async (req, res) => {
  try {
    const { messages } = req.body

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ message: 'Invalid req body' })
    }

    await Message.deleteMany({ _id: { $in: messages } })

    res.json({ message: 'Message deleted successfully' })
  } catch (err) {
    console.log('Error ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// endpoint to show all friend requests
app.get('/friend-requests/sent/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)
      .populate('sendFriendRequests', 'name email image')
      .lean()

    const sendFriendRequests = user.sendFriendRequests

    res.json(sendFriendRequests)
  } catch (err) {
    console.log('Error: ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// endpoint to show all friends
app.get('/friends/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)
      .populate('friends')
      .then((user) => {
        if (!user) {
          return res.status(404).json({ message: 'User not found' })
        }
        const friendIds = user.friends.map((friend) => friend._id)
        res.status(200).json(friendIds)
      })
  } catch (err) {
    console.log('Error: ', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

// socket
global.onlineUsers = new Map()
io.on('connection', (socket) => {
  socket.on('add-user', (userId) => {
    onlineUsers.set(userId, socket.id)
    console.log('Online users: ', onlineUsers)
  })
  socket.on('sent-message', (data) => {
    const socketID = onlineUsers.get(data.recepientId)
    console.log('SocketID: ', socketID)
    socket.to(socketID).emit('receive-message', data)
  })
})

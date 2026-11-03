import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    firebaseUid: { 
        type: String, 
        required: true, 
        unique: true 
    },
    name: { 
        type: String, 
        required: true 
    },
    email: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true,
        trim: true
    },
    emailVerified: { 
        type: Boolean, 
        default: false 
    },
    profilePicture: { 
        type: String, 
        default: null 
    },
    phone: {
        type: String,
        default: null
    },
    preferences: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    preferredLanguage: {
        type: String,
        enum: ['en', 'hi', 'bn'],
        default: 'en'
    },
    aiSubscription: {
        plan: {
            type: String,
            enum: ['free', 'starter', 'pro', 'enterprise'],
            default: 'free'
        },
        monthlyLimit: {
            type: Number,
            default: 250
        },
        usedCredits: {
            type: Number,
            default: 0
        },
        periodStart: {
            type: Date,
            default: Date.now
        },
        periodEnd: {
            type: Date,
            default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        status: {
            type: String,
            enum: ['active', 'past_due', 'exhausted'],
            default: 'active'
        }
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    },
}, {
    timestamps: true
});

userSchema.methods.hasAiCredits = function() {
    if (!this.aiSubscription) {
        this.aiSubscription = {
            plan: 'free',
            monthlyLimit: 250,
            usedCredits: 0,
            periodStart: new Date(),
            periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            status: 'active'
        };
        return true;
    }

    // Auto-rollover if current billing period has elapsed
    if (this.aiSubscription.periodEnd && new Date() > new Date(this.aiSubscription.periodEnd)) {
        this.aiSubscription.usedCredits = 0;
        this.aiSubscription.periodStart = new Date();
        this.aiSubscription.periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        this.aiSubscription.status = 'active';
    }

    const limit = this.aiSubscription.monthlyLimit || 250;
    const used = this.aiSubscription.usedCredits || 0;
    return used < limit;
};

userSchema.methods.consumeAiCredit = async function(credits = 1) {
    if (!this.aiSubscription) {
        this.aiSubscription = {
            plan: 'free',
            monthlyLimit: 250,
            usedCredits: 0,
            periodStart: new Date(),
            periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            status: 'active'
        };
    }

    // Auto-rollover check
    if (this.aiSubscription.periodEnd && new Date() > new Date(this.aiSubscription.periodEnd)) {
        this.aiSubscription.usedCredits = 0;
        this.aiSubscription.periodStart = new Date();
        this.aiSubscription.periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        this.aiSubscription.status = 'active';
    }

    this.aiSubscription.usedCredits = (this.aiSubscription.usedCredits || 0) + credits;
    if (this.aiSubscription.usedCredits >= (this.aiSubscription.monthlyLimit || 250)) {
        this.aiSubscription.status = 'exhausted';
    }
    return this.save();
};

const User = mongoose.model("User", userSchema);

export default User;

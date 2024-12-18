import { NextResponse } from "next/server"
import Stripe from "stripe"
import sgMail from "@sendgrid/mail"
import path from "path"
import fs from "fs/promises"
import nodemailer from "nodemailer"

sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

// const prisma = new PrismaClient()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2024-09-30.acacia",
})

export async function POST(req: Request) {
    const buf = await req.text()
    const sig = req.headers.get("stripe-signature")!
    let event: Stripe.Event

    const transporter = nodemailer.createTransport({
        host: "smtp.office365.com",
        port: 587,
        secure: false, // Use TLS
        auth: {
            user: process.env.MAIL_USERNAME, // Your Microsoft email address
            pass: process.env.MAIL_PASSWORD, // Your Microsoft email password or app password
        },
    })

    try {
        event = stripe.webhooks.constructEvent(
            buf,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET!
        )
    } catch (err) {
        console.error("Webhook verification failed", err)
        return NextResponse.json(
            { error: "Webhook signature verification failed" },
            { status: 400 }
        )
    }

    console.log("Received event", event.type)

    if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session
        const customerEmail = session.customer_details?.email

        if (customerEmail) {
            try {
                const attachmentPath = path.join(
                    process.cwd(),
                    "assets",
                    "workout-plan-ebook.pdf"
                )
                const fileContent = await fs.readFile(attachmentPath)
                const base64File = fileContent.toString("base64")

                const lineItems = await stripe.checkout.sessions.listLineItems(
                    session.id
                )

                // Process line items
                for (const item of lineItems.data) {
                    const priceId = item?.price?.id

                    if (priceId === process.env.STRIPE_PRICE_ID) {
                        console.log("Matched Price ID. Sending emails...")

                        // Prepare email promises
                        const emailPromises = [
                            sgMail
                                .send({
                                    from: process.env.EMAIL_FROM!,
                                    to: customerEmail,
                                    subject: "Body Craft System Ebook",
                                    text: "Thank you for your purchase! Here is your ebook!.",
                                    attachments: [
                                        {
                                            content: base64File,
                                            filename: "workout-plan-ebook.pdf",
                                            type: "application/pdf",
                                            disposition: "attachment",
                                        },
                                    ],
                                })
                                .then(() =>
                                    console.log(
                                        "SendGrid: Email to customer sent successfully"
                                    )
                                )
                                .catch((err) =>
                                    console.error(
                                        "SendGrid: Error sending email to customer",
                                        err
                                    )
                                ),

                            transporter
                                .sendMail({
                                    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
                                    to: customerEmail,
                                    subject: "Body Craft System Ebook",
                                    text: "Thank you for your purchase! Here is your ebook!.",
                                    attachments: [
                                        {
                                            contentType: "application/pdf",
                                            path: attachmentPath,
                                            filename: "workout-plan-ebook.pdf",
                                        },
                                    ],
                                })
                                .then(() =>
                                    console.log(
                                        "Nodemailer: Email to customer sent successfully"
                                    )
                                )
                                .catch((err) =>
                                    console.error(
                                        "Nodemailer: Error sending email to customer",
                                        err
                                    )
                                ),

                            sgMail
                                .send({
                                    from: process.env.EMAIL_FROM!,
                                    to: "laupwing@gmail.com",
                                    subject: "New Order",
                                    text: `New order from ${customerEmail}`,
                                })
                                .then(() =>
                                    console.log(
                                        "SendGrid: New order notification sent successfully"
                                    )
                                )
                                .catch((err) =>
                                    console.error(
                                        "SendGrid: Error sending new order notification",
                                        err
                                    )
                                ),
                        ]

                        // Wait for all email promises to resolve
                        await Promise.all(emailPromises)

                        console.log("All emails sent successfully")
                    }
                }
            } catch (err) {
                console.error("Error processing session", err)
                return NextResponse.json(
                    { error: "Error processing session" },
                    { status: 500 }
                )
            }
        }
    }

    return NextResponse.json({ received: true })
}

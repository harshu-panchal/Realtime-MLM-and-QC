import React, { useState, useEffect } from 'react';
import { ChevronLeft, ScrollText, Shield, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@core/context/SettingsContext';
import axiosInstance from '@core/api/axios';

const ICONS = {
    terms: ScrollText,
    privacy: Shield,
};

const DEFAULTS = {
    terms: {
        customer: {
            title: 'Terms & Conditions - Customer',
            content: `<h3>1. Acceptance of Terms</h3>
            <p>Welcome to our Quick Commerce and MLM Platform. By using our application, creating an account, or placing an order, you agree to comply with and be bound by these Terms and Conditions.</p>
            <h3>2. User Account & Eligibility</h3>
            <p>You must be at least 18 years of age to register. You are responsible for maintaining the confidentiality of your login credentials and for all activities under your account.</p>
            <h3>3. Orders, Pricing & Delivery</h3>
            <p>All orders placed are subject to product availability and delivery radius. Prices displayed are inclusive of applicable taxes unless stated otherwise. Delivery times are estimates and may vary based on traffic and weather conditions.</p>
            <h3>4. Payments & Refunds</h3>
            <p>Payments can be made via Online gateways (UPI, Cards, NetBanking) or Cash on Delivery (COD). In case of damaged or missing items, refunds will be processed to your wallet or original payment source as per our refund policy.</p>
            <h3>5. Termination</h3>
            <p>We reserve the right to suspend or terminate accounts that engage in fraudulent activities, abuse referral/cashback mechanisms, or violate community guidelines.</p>`,
        },
        seller: {
            title: 'Seller Terms & Conditions',
            content: `<h3>1. Merchant Partnership Agreement</h3>
            <p>By registering as a merchant/vendor on our platform, you agree to list genuine products, maintain quality standards, and fulfill orders in a timely manner.</p>
            <h3>2. Product Quality & Pricing</h3>
            <p>Sellers must ensure that all items listed meet statutory food safety, packaging, and expiry standards. Pricing must remain competitive and compliant with MRP regulations.</p>
            <h3>3. Payouts & Commission</h3>
            <p>Settlements are processed according to agreed payout cycles after deducting applicable platform commissions and processing charges.</p>`,
        },
        delivery: {
            title: 'Delivery Partner Terms of Service',
            content: `<h3>1. Partner Engagement</h3>
            <p>As an independent delivery partner, you provide pickup and drop-off services for orders assigned to you through our system.</p>
            <h3>2. Code of Conduct & Safety</h3>
            <p>Delivery partners must hold a valid driving license, follow road safety regulations, and maintain professionalism when interacting with customers and store owners.</p>
            <h3>3. Earnings & Payouts</h3>
            <p>Payouts are calculated per completed order, distance travelled, and surge incentives. COD cash collected must be deposited according to platform guidelines.</p>`,
        },
    },
    privacy: {
        customer: {
            title: 'Customer Privacy Policy',
            content: `<h3>1. Information We Collect</h3>
            <p>We collect your personal details including your name, contact phone number, delivery address, email ID, device identifiers, and payment transaction metadata to provide you with seamless grocery and commerce delivery services.</p>
            
            <h3>2. How We Use Your Information</h3>
            <p>Your information is used strictly to:</p>
            <ul>
                <li>Process, pack, and accurately deliver your orders in real time.</li>
                <li>Send order status updates, delivery OTPs, and verification messages.</li>
                <li>Manage your wallet balance, MLM cashback, and referral commissions.</li>
                <li>Detect and prevent fraudulent transactions or unauthorized account access.</li>
            </ul>

            <h3>3. Location & GPS Data</h3>
            <p>We access your location data only when you choose your delivery address or track live order delivery. We do not track your location in the background when the app is closed.</p>

            <h3>4. Sharing with Third Parties</h3>
            <p>We never sell your personal data. We only share essential delivery information (name, address, phone number) with assigned Delivery Partners and Sellers to fulfill your order. Payments are securely processed through RBI-approved payment gateways (such as Razorpay/UPI).</p>

            <h3>5. Data Security & Storage</h3>
            <p>All sensitive information, passwords, and tokens are encrypted using industry-standard protocols (SSL/TLS and SHA-256). You have the right to edit your profile or request account deletion at any time via Settings.</p>`,
        },
        seller: {
            title: 'Seller & Merchant Privacy Policy',
            content: `<h3>1. Merchant Information We Collect</h3>
            <p>When you register as a vendor, we collect your business name, owner details, registered address, GST certificate, trade license, store location coordinates, bank account details for settlements, and catalog data.</p>

            <h3>2. Purpose of Collection & Usage</h3>
            <p>Your business and personal data is used to:</p>
            <ul>
                <li>Verify and approve your merchant onboarding status.</li>
                <li>Display your store profile and inventory to customers within your delivery radius.</li>
                <li>Process weekly/daily settlement payouts directly to your registered bank account.</li>
                <li>Calculate seller performance metrics, order fulfillment rates, and platform commissions.</li>
            </ul>

            <h3>3. Document Confidentiality</h3>
            <p>Government ID proofs, trade licenses, and banking credentials uploaded during registration are stored securely on our protected servers. These documents are used solely for legal compliance, KYC verification, and tax reporting.</p>

            <h3>4. Information Displayed to Customers</h3>
            <p>Only public-facing business details (such as Shop Name, Store Address, Open/Close Timings, and Product Catalog) are visible to customers on the app. Your private KYC documents and personal banking details remain strictly confidential.</p>

            <h3>5. Data Retention & Compliance</h3>
            <p>We maintain transaction records and invoices as required under Indian commercial and tax laws (GST). You may update your store profile or request account closure through the Seller Support portal.</p>`,
        },
        delivery: {
            title: 'Delivery Partner Privacy Policy',
            content: `<h3>1. Rider Information We Collect</h3>
            <p>To register and operate as a Delivery Partner, we collect your full name, phone number, emergency contact, residential address, profile photo, vehicle details, Driving License, Aadhar Card, PAN Card, and bank account/IFSC details for payout transfers.</p>

            <h3>2. Real-Time Location Tracking</h3>
            <p><strong>Foreground & Background GPS Tracking:</strong> When you are marked as "Online" on duty, our app collects your real-time GPS location to:</p>
            <ul>
                <li>Assign nearby pickup orders from partner stores.</li>
                <li>Provide live order tracking navigation to customers and support teams.</li>
                <li>Calculate accurate travel distance, route surcharges, and per-km payout incentives.</li>
            </ul>
            <p><em>Note: You can turn your status to "Offline" at any time to pause order assignment and location tracking.</em></p>

            <h3>3. Protection of KYC & Financial Data</h3>
            <p>Your Driving License, Aadhar, and PAN documents are strictly encrypted and accessed only for background verification and regulatory compliance. Bank details are utilized solely for depositing your daily/weekly delivery earnings.</p>

            <h3>4. Customer Interaction Privacy</h3>
            <p>Customers are shown only your first name and live delivery route while their order is active. After an order is completed, your contact details are masked and not retained by the customer.</p>

            <h3>5. Your Rights & Safety</h3>
            <p>You have the right to view your payout history, update your vehicle info, and request data deletion upon termination of your delivery partnership through Rider Support.</p>`,
        },
    },
};

const DynamicLegalPage = ({ type = 'terms', audience = 'customer', onBack }) => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';

    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPage = async () => {
            try {
                setLoading(true);
                const res = await axiosInstance.get('/legal', { params: { type, audience } });
                const data = res.data?.result || res.data?.data || {};
                if (data.exists && data.content) {
                    setPage(data);
                } else {
                    setPage(null);
                }
            } catch {
                setPage(null);
            } finally {
                setLoading(false);
            }
        };
        fetchPage();
    }, [type, audience]);

    const Icon = ICONS[type] || ScrollText;
    const typeGroup = DEFAULTS[type] || DEFAULTS.terms;
    const defaults = typeGroup[audience] || typeGroup.customer || Object.values(typeGroup)[0];
    const title = page?.title || defaults?.title || 'Legal Information';
    const content = page?.content || defaults?.content || '';
    const lastUpdated = page?.updatedAt
        ? new Date(page.updatedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        : null;

    return (
        <div className="min-h-screen bg-slate-50 font-['Outfit',_sans-serif] pb-12 lg:pb-20">
            {/* Header Area */}
            <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
                <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
                    <button
                        onClick={() => onBack ? onBack() : navigate(-1)}
                        className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-full transition-colors -ml-2 shrink-0 text-slate-600 hover:text-slate-900"
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <h1 className="text-xl font-black text-slate-900 tracking-tight truncate">{title}</h1>
                </div>
            </div>

            <div className="px-4 pt-8 lg:pt-12 max-w-5xl mx-auto">
                {loading ? (
                    <div className="bg-white rounded-3xl p-12 flex flex-col items-center justify-center border border-slate-200/60 shadow-xl shadow-slate-200/20 min-h-[400px]">
                        <Loader2 size={36} className="animate-spin text-orange-500 mb-4" />
                        <p className="text-slate-500 font-medium">Loading {title.toLowerCase()}...</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/30 border border-slate-200/60 overflow-hidden">
                        {/* Card Header */}
                        <div className="bg-gradient-to-r from-orange-50 to-orange-100/50 p-6 lg:p-10 border-b border-orange-100/60 flex items-start sm:items-center gap-5 sm:gap-6 flex-col sm:flex-row">
                            <div className="w-14 h-14 rounded-2xl bg-white shadow-md shadow-orange-200/50 flex items-center justify-center text-orange-600 shrink-0">
                                <Icon size={28} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                                    {title}
                                </h2>
                                {lastUpdated && (
                                    <div className="inline-flex items-center gap-1.5 mt-3 bg-white px-3 py-1 rounded-full text-xs font-bold text-slate-500 border border-slate-200 shadow-sm">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        Last updated: {lastUpdated}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Content Body */}
                        <div className="p-6 lg:p-10">
                            <div
                                className="prose prose-slate max-w-none 
                                    prose-headings:font-black prose-headings:tracking-tight prose-headings:text-slate-900
                                    prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl
                                    prose-p:text-slate-600 prose-p:leading-relaxed prose-p:font-medium
                                    prose-a:text-orange-600 prose-a:font-bold prose-a:no-underline hover:prose-a:underline
                                    prose-li:text-slate-600 prose-li:font-medium
                                    prose-strong:font-bold prose-strong:text-slate-900
                                    break-words break-all sm:break-normal overflow-wrap-anywhere"
                                dangerouslySetInnerHTML={{ __html: content }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DynamicLegalPage;

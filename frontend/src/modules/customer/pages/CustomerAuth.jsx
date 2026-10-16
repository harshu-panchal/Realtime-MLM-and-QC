import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@core/context/AuthContext';
import { useSettings } from '@core/context/SettingsContext';
import { useTranslation } from '@core/context/LanguageContext';
import { ChevronLeft, Globe, ChevronDown, CheckCircle2, ShieldCheck, Calendar, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { customerApi } from '../services/customerApi';
import DefaultLogo from '@/assets/DefaultLogo.svg';

const loadRazorpayScript = () => {
    return new Promise((resolve) => {
        if (window.Razorpay) {
            resolve(true);
            return;
        }
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
};

const CustomerAuth = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [showOtp, setShowOtp] = useState(false);
    const pendingSubData = (() => {
        try {
            const raw = sessionStorage.getItem('customer_pending_subscription');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    })();

    const [showSubscriptionStep, setShowSubscriptionStep] = useState(Boolean(pendingSubData));
    const [authPayload, setAuthPayload] = useState(pendingSubData?.authPayload || null);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [isPaymentCompleted, setIsPaymentCompleted] = useState(false);
    const [timer, setTimer] = useState(0);
    const { login } = useAuth();
    const { settings } = useSettings();
    const { t, language, setLanguage, languages } = useTranslation();
    const [isLangOpen, setIsLangOpen] = useState(false);
    const dropdownRef = useRef(null);
    const appName = settings?.appName || 'App';
    const navigate = useNavigate();

    const weeklyFee = Number(settings?.userWeeklySubscriptionFee ?? 50);

    const [formData, setFormData] = useState({
        phone: pendingSubData?.phone || '',
        otp: '',
        name: pendingSubData?.name || '',
        referralCode: new URLSearchParams(window.location.search).get('ref') || ''
    });

    useEffect(() => {
        let interval;
        if (timer > 0) {
            interval = setInterval(() => setTimer(t => t - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [timer]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsLangOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSendOtp = async (e) => {
        e?.preventDefault();
        if (formData.phone.length !== 10) {
            toast.error(t('enterValidPhone'));
            return;
        }
        if (!isLogin && !formData.name.trim()) {
            toast.error(t('enterFullName'));
            return;
        }
        
        setIsLoading(true);
        try {
            if (isLogin) {
                await customerApi.sendLoginOtp({ phone: formData.phone });
            } else {
                await customerApi.sendSignupOtp({ 
                    name: formData.name, 
                    phone: formData.phone,
                    referralCode: formData.referralCode
                });
            }
            setShowOtp(true);
            setTimer(30);
            toast.success(t('otpSent'));
        } catch (error) {
            const apiMessage = error?.response?.data?.message || 'Failed to send OTP';
            toast.error(apiMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (formData.otp.length !== 4) {
            toast.error('Enter 4-digit code');
            return;
        }
        setIsLoading(true);
        try {
            const response = await customerApi.verifyOtp({ phone: formData.phone, otp: formData.otp });
            const { token, customer } = response.data.result;

            const sub = customer?.weeklySubscription || {};
            const isSubActive = sub.status === 'active' && sub.expiresAt && new Date(sub.expiresAt) > new Date();

            // Check if user needs subscription (if weekly fee > 0 and user has no active subscription)
            if (weeklyFee > 0 && !isSubActive) {
                setAuthPayload({ token, customer });
                setShowSubscriptionStep(true);
                sessionStorage.setItem('customer_pending_subscription', JSON.stringify({
                    authPayload: { token, customer },
                    phone: formData.phone,
                    name: formData.name || customer?.name,
                }));
                toast.info('Please complete your weekly subscription to continue.');
                return;
            }

            login({ ...customer, token, role: 'customer' });
            toast.success(t('loggedInSuccess'));
            navigate('/', { replace: true });
        } catch (error) {
            const apiMessage = error?.response?.data?.message;
            toast.error(apiMessage || t('invalidOtp'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleInitiateSubscriptionPayment = async () => {
        setIsProcessingPayment(true);
        try {
            const isLoaded = await loadRazorpayScript();
            if (!isLoaded) {
                toast.error("Razorpay SDK failed to load. Please check your internet connection.");
                return;
            }

            const res = await customerApi.createSubscriptionOrder({
                phone: formData.phone,
            });

            if (res.data?.result?.exempt) {
                finalizeSubscriptionSuccess(authPayload?.customer);
                return;
            }

            const { razorpayOrderId, amount, currency, keyId } = res.data?.result || {};
            if (!razorpayOrderId) {
                throw new Error("Unable to create subscription order");
            }

            const options = {
                key: keyId || import.meta.env.VITE_RAZORPAY_KEY_ID || "rzp_test_b0PSRa7kNhbHj3",
                amount: Math.round(amount * 100),
                currency: currency || "INR",
                name: appName,
                description: "Weekly Customer Subscription (Saturday-to-Saturday)",
                order_id: razorpayOrderId,
                prefill: {
                    name: authPayload?.customer?.name || formData.name || "Customer",
                    contact: formData.phone,
                },
                theme: {
                    color: "#f97316",
                },
                handler: async (paymentResponse) => {
                    try {
                        const verifyRes = await customerApi.verifySubscriptionPayment({
                            razorpay_order_id: paymentResponse.razorpay_order_id,
                            razorpay_payment_id: paymentResponse.razorpay_payment_id,
                            razorpay_signature: paymentResponse.razorpay_signature,
                            phone: formData.phone,
                            customerId: authPayload?.customer?._id,
                        });

                        const updatedCust = verifyRes.data?.result?.customer || authPayload?.customer;
                        setIsPaymentCompleted(true);
                        toast.success("Weekly subscription activated successfully!");
                        setTimeout(() => {
                            finalizeSubscriptionSuccess(updatedCust);
                        }, 1200);
                    } catch (verifyErr) {
                        toast.error(verifyErr?.response?.data?.message || "Payment verification failed.");
                    }
                },
                modal: {
                    ondismiss: () => {
                        setIsProcessingPayment(false);
                    },
                },
            };

            const rzp = new window.Razorpay(options);
            rzp.on("payment.failed", (response) => {
                toast.error(response?.error?.description || "Payment failed");
                setIsProcessingPayment(false);
            });
            rzp.open();
        } catch (err) {
            toast.error(err?.response?.data?.message || err.message || "Failed to initiate payment");
        } finally {
            setIsProcessingPayment(false);
        }
    };

    const finalizeSubscriptionSuccess = (updatedCustomer) => {
        sessionStorage.removeItem('customer_pending_subscription');
        if (authPayload) {
            login({
                ...authPayload.customer,
                ...updatedCustomer,
                weeklySubscription: {
                    status: 'active',
                    amount: weeklyFee,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
                token: authPayload.token,
                role: 'customer',
            });
            navigate('/', { replace: true });
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-8 font-['Outfit',_sans-serif]">
            <div className="w-full max-w-[380px] bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-50">
                {/* Logo */}
                <div className="flex flex-col items-center justify-center mb-6">
                    <img 
                        src={settings?.logoUrl || DefaultLogo}
                        alt={`${appName} Logo`}
                        className="h-28 w-auto object-contain" 
                    />
                </div>

                {/* Language Switcher Section */}
                <div className="mb-6 pb-4 border-b border-gray-100 flex flex-col items-center">
                    {/* Desktop Dropdown */}
                    <div ref={dropdownRef} className="hidden md:block relative w-full">
                        <button
                            type="button"
                            onClick={() => setIsLangOpen(!isLangOpen)}
                            className="w-full flex items-center justify-between bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-700 transition-all focus:outline-none"
                        >
                            <div className="flex items-center gap-2">
                                <Globe size={16} className="text-gray-400" />
                                <span>{languages.find(l => l.code === language)?.flag} {languages.find(l => l.code === language)?.name}</span>
                            </div>
                            <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isLangOpen ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {isLangOpen && (
                            <div className="absolute right-0 left-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-lg z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                {languages.map((lang) => (
                                    <button
                                        key={lang.code}
                                        type="button"
                                        onClick={() => {
                                            setLanguage(lang.code);
                                            setIsLangOpen(false);
                                        }}
                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-gray-50 ${language === lang.code ? 'bg-orange-50/50 text-[#f97316] font-semibold' : 'text-gray-700'}`}
                                    >
                                        <span className="text-base">{lang.flag}</span>
                                        <span>{lang.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Mobile pills (dropdown nhi) */}
                    <div className="block md:hidden w-full">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Globe size={12} /> Language / भाषा
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-start">
                            {languages.map((lang) => (
                                <button
                                    key={lang.code}
                                    type="button"
                                    onClick={() => setLanguage(lang.code)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                                        language === lang.code
                                            ? 'bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-500/20'
                                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    <span>{lang.flag}</span>
                                    <span>{lang.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                
                {showSubscriptionStep ? (
                    <>
                        <div className="text-left mb-6">
                            <div className="flex items-center gap-2 mb-1">
                                <ShieldCheck className="text-[#f97316] h-6 w-6" />
                                <h2 className="text-xl font-bold text-gray-900">
                                    Step 2: Weekly Subscription
                                </h2>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                                Saturday-to-Saturday cycle. Mandatory for account activation.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div className="p-4 bg-orange-50/60 border border-orange-200/80 rounded-2xl space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-gray-600">Weekly Access Fee</span>
                                    <span className="text-lg font-black text-orange-600">₹{weeklyFee}</span>
                                </div>
                                <div className="text-[11px] text-gray-600 space-y-1.5 pt-2 border-t border-orange-200/60">
                                    <div className="flex items-center gap-1.5">
                                        <Calendar className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                                        <span>Cycle: <b>Saturday to Saturday</b></span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                        <span>Cutoff: <b>Saturday 12:00 PM (Noon)</b></span>
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-1">
                                        * Realtime notifications will alert you prior to expiry.
                                    </div>
                                </div>
                            </div>

                            {isPaymentCompleted ? (
                                <div className="py-4 text-center space-y-2 bg-emerald-50 border border-emerald-200 rounded-2xl">
                                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto animate-bounce" />
                                    <p className="text-xs font-bold text-emerald-700">Payment Verified! Redirecting...</p>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    disabled={isProcessingPayment}
                                    onClick={handleInitiateSubscriptionPayment}
                                    className="w-full text-white bg-[#f97316] hover:bg-orange-600 py-3.5 rounded-xl text-sm font-bold tracking-wide flex items-center justify-center gap-2 transition-all shadow-md shadow-orange-500/20 active:scale-[0.98] disabled:opacity-70"
                                >
                                    {isProcessingPayment ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span>Opening Razorpay...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Pay ₹{weeklyFee} with Razorpay</span>
                                            <ArrowRight className="h-4 w-4" />
                                        </>
                                    )}
                                </button>
                            )}

                            <div className="text-center pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        sessionStorage.removeItem('customer_pending_subscription');
                                        setShowSubscriptionStep(false);
                                        setShowOtp(false);
                                    }}
                                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                                >
                                    Cancel & back to login
                                </button>
                            </div>
                        </div>
                    </>
                ) : !showOtp ? (
                    <>
                        <div className="text-left mb-6">
                            <h2 className="text-xl font-bold text-gray-900">
                                {t('loginSignup')}
                            </h2>
                            <p className="mt-1 text-sm text-gray-500">
                                {isLogin ? t('enterMobile') : t('createAccount')}
                            </p>
                        </div>

                        <form className="space-y-4" onSubmit={handleSendOtp}>
                            {!isLogin && (
                                <div className="space-y-4">
                                    <div className="relative">
                                        <input
                                            required
                                            type="text"
                                            name="name"
                                            value={formData.name}
                                            placeholder={t('fullName')}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-gray-800 outline-none focus:border-[#f97316] focus:ring-1 focus:ring-[#f97316] transition-all"
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            name="referralCode"
                                            value={formData.referralCode}
                                            placeholder={t('referralCode')}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-gray-800 outline-none focus:border-[#f97316] focus:ring-1 focus:ring-[#f97316] transition-all uppercase"
                                            onChange={(e) => setFormData({ ...formData, referralCode: e.target.value.toUpperCase() })}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="relative flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-[#f97316] focus-within:ring-1 focus-within:ring-[#f97316] transition-all bg-white">
                                <div className="pl-4 pr-3 py-3.5 font-bold text-gray-600 border-r border-gray-200 bg-gray-50">
                                    +91
                                </div>
                                <input
                                    required
                                    type="tel"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    autoComplete="tel"
                                    name="phone"
                                    value={formData.phone}
                                    maxLength={10}
                                    placeholder={isLogin ? "9671310143" : t('mobileNumber')}
                                    className="w-full px-4 py-3.5 text-sm font-semibold text-gray-800 outline-none bg-transparent"
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full mt-2 text-white bg-[#f97316] hover:bg-orange-600 py-3.5 rounded-xl text-sm font-bold tracking-wide flex items-center justify-center gap-3 transition-all"
                            >
                                {isLoading ? t('pleaseWait') : t('continue')}
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <button
                                onClick={() => setIsLogin(!isLogin)}
                                className="text-sm font-semibold text-gray-500 hover:text-[#f97316] transition-colors"
                            >
                                {isLogin ? t('newUser') : t('alreadyAccount')}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="text-left mb-6">
                            <div className="flex items-center gap-3 mb-1">
                                <button
                                    onClick={() => setShowOtp(false)}
                                    className="text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <h2 className="text-xl font-bold text-gray-900">
                                    {t('verifyOtp')}
                                </h2>
                            </div>
                            <p className="mt-1 text-sm text-gray-500 ml-8">
                                {t('sentTo')} +91 {formData.phone}
                            </p>
                        </div>

                        <form onSubmit={handleVerifyOtp} className="space-y-6">
                            <div className="flex justify-center gap-2">
                                {[...Array(4)].map((_, i) => (
                                    <input
                                        key={i}
                                        type="tel"
                                        maxLength={1}
                                        className="w-12 h-14 bg-gray-50 border border-gray-200 rounded-xl text-center text-xl font-bold text-gray-900 outline-none focus:bg-white focus:border-[#f97316] focus:ring-1 focus:ring-[#f97316] transition-all"
                                        value={formData.otp[i] || ''}
                                        onKeyDown={(e) => {
                                            const target = /** @type {HTMLInputElement} */ (e.currentTarget);
                                            if (e.key === 'Backspace' && !target.value && i > 0) {
                                                const prev = /** @type {HTMLInputElement | null} */ (target.previousElementSibling);
                                                if (prev) prev.focus();
                                            }
                                        }}
                                        onChange={(e) => {
                                            const target = /** @type {HTMLInputElement} */ (e.currentTarget);
                                            const val = target.value;
                                            if (val && i < 3) {
                                                const next = /** @type {HTMLInputElement | null} */ (target.nextElementSibling);
                                                if (next) next.focus();
                                            }
                                            const otpArr = formData.otp.split('');
                                            otpArr[i] = val;
                                            setFormData({ ...formData, otp: otpArr.join('') });
                                        }}
                                    />
                                ))}
                            </div>

                            <div className="space-y-4">
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full text-white bg-[#f97316] hover:bg-orange-600 py-3.5 rounded-xl text-sm font-bold tracking-wide flex items-center justify-center transition-all"
                                >
                                    {isLoading ? t('verifying') : t('verifyProceed')}
                                </button>
                                <div className="flex justify-center">
                                    <button
                                        type="button"
                                        disabled={timer > 0}
                                        onClick={handleSendOtp}
                                        className={`text-sm font-semibold ${timer > 0 ? 'text-gray-400' : 'text-[#f97316] hover:underline'}`}
                                    >
                                        {timer > 0 ? `${t('resendIn')} ${timer}s` : t('resendCode')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </>
                )}

                {/* Legal Agreement Footer */}
                {!showOtp && !showSubscriptionStep && (
                    <div className="pt-8 flex flex-col items-center gap-1.5">
                        <p className="text-[11px] text-gray-400 text-center font-medium">
                            {t('agreeText')}
                        </p>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => navigate('/support')}
                                className="text-[11px] font-semibold text-gray-500 hover:text-[#f97316] transition-colors"
                            >
                                {t('terms')}
                            </button>
                            <span className="text-[10px] text-gray-300">•</span>
                            <button 
                                onClick={() => navigate('/privacy')}
                                className="text-[11px] font-semibold text-gray-500 hover:text-[#f97316] transition-colors"
                            >
                                {t('privacy')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomerAuth;



import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save, User, Mail, Phone, MapPin, Calendar, Droplet, Camera, Loader2 } from "lucide-react";
import Button from "@/shared/components/ui/Button";
import Input from "@/shared/components/ui/Input";
import { toast } from "sonner";
import { useAuth } from "@core/context/AuthContext";
import axiosInstance from "@core/api/axios";
import { deliveryApi } from "@/modules/delivery/services/deliveryApi";

const PersonalDetails = () => {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const { user, refreshUser } = useAuth();
  const fileInputRef = React.useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [profileImagePreview, setProfileImagePreview] = useState(user?.profileImage || "");
  const [formData, setFormData] = useState({
    fullName: user?.name || "",
    phone: user?.phone || user?.mobile || "",
    email: user?.email || "",
    address: user?.address || "",
    dob: user?.dob ? new Date(user.dob).toISOString().split('T')[0] : "",
    bloodGroup: user?.bloodGroup || "",
  });

  // Update if user loads later
  React.useEffect(() => {
    if (user) {
      setProfileImagePreview(user.profileImage || user.avatar || "");
      setFormData({
        fullName: user.name || "",
        phone: user.phone || user.mobile || "",
        email: user.email || "",
        address: user.address || "",
        dob: user.dob ? new Date(user.dob).toISOString().split('T')[0] : "",
        bloodGroup: user.bloodGroup || "",
      });
    }
  }, [user]);

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image size must be less than 10MB");
      return;
    }

    // Local preview immediately
    const previewUrl = URL.createObjectURL(file);
    setProfileImagePreview(previewUrl);

    try {
      setIsUploading(true);
      toast.loading("Uploading photo...", { id: "profile-upload" });

      const uploadData = new FormData();
      uploadData.append("file", file);

      const res = await axiosInstance.post("/media/upload", uploadData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const uploadedUrl = res.data?.result?.url || res.data?.result?.secureUrl;
      if (!uploadedUrl) {
        throw new Error("No URL returned from upload");
      }

      setProfileImagePreview(uploadedUrl);

      // Save directly to delivery profile in DB
      await deliveryApi.updateProfile({ profileImage: uploadedUrl });
      if (refreshUser) await refreshUser();

      toast.success("Profile photo updated successfully!", { id: "profile-upload" });
    } catch (err) {
      console.error("Profile image upload failed:", err);
      toast.error(err.response?.data?.message || "Failed to upload photo", { id: "profile-upload" });
      setProfileImagePreview(user?.profileImage || "");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      toast.loading("Saving details...", { id: "save-profile" });
      await deliveryApi.updateProfile({
        name: formData.fullName,
        email: formData.email,
        address: formData.address,
        bloodGroup: formData.bloodGroup,
        ...(profileImagePreview ? { profileImage: profileImagePreview } : {}),
      });
      if (refreshUser) await refreshUser();
      setIsEditing(false);
      toast.success("Personal details updated successfully!", { id: "save-profile" });
    } catch (err) {
      console.error("Failed to update profile:", err);
      toast.error(err.response?.data?.message || "Failed to update details", { id: "save-profile" });
    }
  };

  return (
    <div className="min-h-screen bg-white pb-24">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="flex items-center p-4">
          <button 
            onClick={() => navigate(-1)} 
            className="p-2 rounded-full hover:bg-gray-100 transition-colors mr-2"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="ds-h3 text-gray-900">Personal Details</h1>
          <div className="ml-auto">
            {isEditing ? (
              <Button size="sm" onClick={handleSave} className="h-8 px-3">
                Save
              </Button>
            ) : (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setIsEditing(true)} 
                className="text-primary hover:bg-primary/5"
              >
                Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-6">
        {/* Profile Photo */}
        <div className="flex flex-col items-center justify-center py-6">
          <div className="relative group">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="hidden"
            />
            <div 
              onClick={() => isEditing && fileInputRef.current?.click()}
              className={`w-28 h-28 rounded-full p-1 bg-white shadow-md relative overflow-hidden ${
                isEditing ? "cursor-pointer ring-2 ring-primary ring-offset-2 hover:opacity-90 transition-all" : ""
              }`}
            >
              <img
                src={profileImagePreview || user?.profileImage || user?.avatar || "/placeholder-avatar.png"}
                alt="Profile"
                className="w-full h-full rounded-full object-cover bg-gray-100"
              />
              {isUploading && (
                <div className="absolute inset-0 bg-black/50 rounded-full flex flex-col items-center justify-center text-white">
                  <Loader2 size={24} className="animate-spin mb-1" />
                  <span className="text-[10px] font-medium">Uploading</span>
                </div>
              )}
            </div>
            {isEditing && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                aria-label="Upload profile image"
                className="absolute bottom-1 right-1 bg-primary text-primary-foreground p-2 rounded-full shadow-lg hover:bg-primary/90 transition-transform active:scale-95 border-2 border-white"
              >
                {isUploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              </button>
            )}
          </div>
          {isEditing && (
            <p className="mt-2 text-xs text-primary font-medium cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              Tap to change photo
            </p>
          )}
          <p className="mt-3 text-sm text-gray-500">Delivery Partner ID: {user?.deliveryBoyId || user?._id?.slice(-6) || "N/A"}</p>
        </div>

        {/* Form Fields */}
        <div className="space-y-4 bg-white p-4 rounded-xl shadow-sm">
          <Input
            label="Full Name"
            value={formData.fullName}
            readOnly={!isEditing} // Usually name is locked after verification
            icon={User}
            className={!isEditing ? "bg-gray-50 border-transparent" : ""}
          />
          
          <Input
            label="Phone Number"
            value={formData.phone}
            readOnly={true} // Phone is usually locked
            icon={Phone}
            className="bg-gray-50 border-transparent text-gray-500"
            helperText="Contact support to change phone number"
          />

          <Input
            label="Email Address"
            value={formData.email}
            readOnly={!isEditing}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            icon={Mail}
            type="email"
            className={!isEditing ? "bg-gray-50 border-transparent" : ""}
          />

          <div className="relative">
            <label className="block text-xs font-medium text-gray-700 mb-1 ml-1">Current Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <MapPin size={18} />
              </div>
              <textarea
                value={formData.address}
                readOnly={!isEditing}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                className={`w-full pl-10 pr-4 py-2 rounded-xl text-sm border focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none ${
                  !isEditing ? "bg-gray-50 border-transparent text-gray-600" : "bg-white border-gray-200"
                }`}
                rows={3}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Date of Birth"
              value={formData.dob}
              readOnly={true}
              icon={Calendar}
              className="bg-gray-50 border-transparent"
            />
            <Input
              label="Blood Group"
              value={formData.bloodGroup}
              readOnly={!isEditing}
              onChange={(e) => setFormData({...formData, bloodGroup: e.target.value})}
              icon={Droplet}
              className={!isEditing ? "bg-gray-50 border-transparent" : ""}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PersonalDetails;

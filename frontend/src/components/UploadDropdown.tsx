'use client';

import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '@/utils/api';

interface UploadDropdownProps {
  onUploadSuccess: (transactions: any[], source: string) => void;
  onManualEntryClick: () => void;
}

export default function UploadDropdown({ onUploadSuccess, onManualEntryClick }: UploadDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // PDF Decryption Modal State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Standard File Ingestion (CSV/PDF)
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await apiFetch('/data/upload-statement', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        onUploadSuccess(data.transactions || [], data.source_format?.toUpperCase() || 'CSV/PDF');
        // Scroll staging area into view after render
        setTimeout(() => {
          const stagingEl = document.getElementById('ingestion-staging-area');
          if (stagingEl) {
            stagingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);
      } else {
        const clone = res.clone();
        try {
          const err = await clone.json();
          // Catch specific PDF Password Required error code
          if (res.status === 401 && err.detail === 'PDF_PASSWORD_REQUIRED') {
            setPendingFile(file);
            setIsPasswordModalOpen(true);
            return;
          }
          alert(`Failed to upload: ${err.detail || 'Unknown error'}`);
        } catch {
          alert(`Failed to upload: Status ${res.status}`);
        }
      }
    } catch (err) {
      alert('Error connecting to the server.');
    } finally {
      setIsUploading(false);
      setIsOpen(false);
      event.target.value = ''; // Reset input element
    }
  };

  // Re-submit PDF ingestion with User-provided Password
  const uploadWithPassword = async (file: File, pw: string) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', pw);

      const res = await apiFetch('/data/upload-statement', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const txns = data.transactions || [];
        // Close modal and clear state ONLY on success
        setIsPasswordModalOpen(false);
        setPendingFile(null);
        setPdfPassword('');
        onUploadSuccess(txns, data.source_format?.toUpperCase() || 'PDF');

        // Scroll staging area into view after a short delay
        setTimeout(() => {
          const stagingEl = document.getElementById('ingestion-staging-area');
          if (stagingEl) {
            stagingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);

        if (txns.length === 0) {
          alert(
            data.message ||
            'The PDF was unlocked but no transactions could be extracted. The statement format may not be supported yet.'
          );
        }
      } else {
        const err = await res.json();
        if (err.detail === 'PDF_PASSWORD_REQUIRED') {
          setIsErrorModalOpen(true);
          setPdfPassword('');
          // Keep modal open for retry — do NOT close it
        } else {
          alert(`Failed to upload: ${err.detail || 'Unknown error'}`);
          setIsPasswordModalOpen(false);
          setPendingFile(null);
          setPdfPassword('');
        }
      }
    } catch (err) {
      alert('Error connecting to the server.');
      // Keep modal open so user can retry
    } finally {
      setIsUploading(false);
    }
  };

  // OCR Screenshot Statement Upload
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await apiFetch('/data/upload-screenshot', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        onUploadSuccess(data.transactions || [], 'Screenshot');
      } else {
        const err = await res.json();
        alert(`Failed to scan: ${err.detail || 'Unknown error'}`);
      }
    } catch (err) {
      alert('Error connecting to the server.');
    } finally {
      setIsUploading(false);
      setIsOpen(false);
      event.target.value = ''; // Reset input element
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        disabled={isUploading}
        className="px-4 py-2 text-sm font-semibold rounded bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-wait"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isUploading ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          )}
        </svg>
        <span>{isUploading ? 'Uploading...' : 'Add Transaction'}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-black/90 backdrop-blur-md border border-white/10 z-50">
          <div className="py-1" role="menu" aria-orientation="vertical">
            <button 
              type="button"
              onClick={() => {
                onManualEntryClick();
                setIsOpen(false);
              }}
              className="w-full text-left group flex items-center px-4 py-2 text-sm text-gray-300 hover:bg-white/10 cursor-pointer"
            >
              <svg className="mr-3 h-5 w-5 text-gray-450 group-hover:text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Manual Cash Entry
            </button>
            <label className="group flex items-center px-4 py-2 text-sm text-gray-300 hover:bg-white/10 cursor-pointer border-t border-white/10">
              <svg className="mr-3 h-5 w-5 text-gray-455 group-hover:text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Upload Statement (CSV/PDF)
              <input type="file" accept=".csv,.pdf" className="hidden" onChange={handleFileUpload} />
            </label>
            <label className="group flex items-center px-4 py-2 text-sm text-gray-300 hover:bg-white/10 cursor-pointer border-t border-white/10">
              <svg className="mr-3 h-5 w-5 text-gray-455 group-hover:text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Scan Screenshot (Image)
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          </div>
        </div>
      )}

      {/* Encrypted PDF Password Modal */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-sm w-full overflow-hidden animate-zoom-in">
            {/* Modal Header */}
            <div className="bg-white/[0.02] border-b border-white/10 px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center space-x-2">
                <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Encrypted PDF Password</span>
              </h3>
              <button 
                onClick={() => {
                  setIsPasswordModalOpen(false);
                  setPendingFile(null);
                  setPdfPassword('');
                }}
                className="text-gray-400 hover:text-white transition-colors focus:outline-none"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!pdfPassword || !pendingFile) return;
              await uploadWithPassword(pendingFile, pdfPassword);
            }} className="p-5 space-y-4">
              <p className="text-xs text-gray-300 leading-normal">
                The file <span className="font-semibold text-white">{pendingFile?.name}</span> is password-protected. Please enter the decryption key below.
              </p>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">PDF Password</label>
                <input
                  type="password"
                  required
                  placeholder="Enter decryption password"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  className="w-full border border-white/10 bg-white/5 text-white placeholder-gray-500 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900]"
                />
              </div>

              {/* Actions Footer */}
              <div className="pt-4 border-t border-white/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsPasswordModalOpen(false);
                    setPendingFile(null);
                    setPdfPassword('');
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded border border-white/10 hover:bg-white/10 text-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold rounded bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer"
                >
                  Unlock & Parse
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Incorrect PDF Password Error Modal */}
      {isErrorModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 max-w-sm w-full text-center text-white shadow-2xl animate-zoom-in">
            {/* Warning Icon SVG */}
            <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <h3 className="text-lg font-bold tracking-tight text-white mb-2">Incorrect PDF Password</h3>
            <p className="text-xs text-gray-400 mb-6 leading-relaxed">
              Incorrect PDF password. Please try again.
            </p>

            {/* Close CTA Button */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => setIsErrorModalOpen(false)}
                className="w-full py-2.5 px-4 rounded text-xs font-bold bg-gradient-to-r from-[#FF9900] to-[#FFB84D] text-black hover:from-[#EC7211] hover:to-[#FF9900] shadow-sm transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type Language = 'en' | 'kn'
export type UserRole = 'vendor' | 'superadmin'
export type EnquiryStatus = 'new' | 'contacted' | 'completed' | 'closed'
export type VendorApplicationStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type StockStatus = 'in-stock' | 'low-stock' | 'out-of-stock'

export type Product = {
  id: string
  vendor_id: string | null
  name_en: string
  name_kn: string
  description_en: string
  description_kn: string
  category: string
  image_url: string | null
  mrp: number | null
  selling_price: number | null
  stock_quantity: number
  low_stock_threshold: number
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type PublicCatalogueProduct = Pick<Product,
  'id' | 'name_en' | 'name_kn' | 'description_en' | 'description_kn' |
  'category' | 'image_url' | 'mrp' | 'selling_price' | 'is_active' |
  'sort_order' | 'created_at' | 'updated_at'
> & { stock_status: StockStatus }

export type VendorApplication = {
  id: string
  business_name: string
  owner_name: string
  phone: string
  email: string
  location: string
  status: VendorApplicationStatus
  rejection_reason: string | null
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
  updated_at: string
}

export type VendorApplicationEvent = {
  id: number
  application_id: string
  actor_id: string | null
  action: 'submitted' | 'resubmitted' | 'approved' | 'rejected' | 'suspended' | 'reactivated'
  reason: string | null
  created_at: string
}

export type Profile = {
  id: string
  display_name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ShopSettings = {
  id: number
  shop_name: string
  whatsapp_number: string
  address: string
  logo_url: string | null
  description: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Enquiry = {
  id: string
  reference_code: string
  customer_name: string
  customer_phone: string
  status: EnquiryStatus
  created_at: string
  updated_at: string
}

export type EnquiryItem = {
  id: string
  enquiry_id: string
  product_id: string | null
  product_name_snapshot: string
  quantity: number
  mrp_snapshot: number | null
  selling_price_snapshot: number | null
  created_at: string
}

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, Pick<Profile, 'id' | 'display_name' | 'role' | 'is_active'>>
      shop_settings: Table<ShopSettings, Omit<ShopSettings, 'created_at' | 'updated_at'>>
      products: Table<Product, Omit<Product, 'created_at' | 'updated_at'>>
      enquiries: Table<Enquiry, Omit<Enquiry, 'id' | 'created_at' | 'updated_at'>>
      enquiry_items: Table<EnquiryItem, Omit<EnquiryItem, 'id' | 'created_at'>>
      vendor_applications: Table<VendorApplication, Omit<VendorApplication, 'created_at' | 'updated_at'>>
      vendor_application_events: Table<VendorApplicationEvent, Omit<VendorApplicationEvent, 'id' | 'created_at'>>
    }
    Views: {
      public_catalogue_products: {
        Row: PublicCatalogueProduct
        Relationships: []
      }
    }
    Functions: {
      submit_interest: {
        Args: {
          p_customer_name: string
          p_customer_phone: string
          p_items: { product_id: string; quantity: number }[]
        }
        Returns: { enquiry_id: string; reference_code: string }
      }
      submit_vendor_application: {
        Args: { p_business_name: string; p_owner_name: string; p_phone: string; p_location: string }
        Returns: VendorApplication
      }
      approve_vendor_application: {
        Args: { p_application_id: string }
        Returns: undefined
      }
      reject_vendor_application: {
        Args: { p_application_id: string; p_reason: string }
        Returns: undefined
      }
      set_vendor_access: {
        Args: { p_vendor_id: string; p_is_active: boolean }
        Returns: undefined
      }
    }
    Enums: {
      user_role: UserRole
      enquiry_status: EnquiryStatus
      vendor_application_status: VendorApplicationStatus
    }
    CompositeTypes: Record<string, never>
  }
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addBrandPerson, PeopleServiceError } from "../../services/peopleService";
import type { AddBrandPersonInput } from "../../types/people";
import { marketingKeys } from "./marketingKeys";
export function useAddBrandPerson(brandId:string){
  const qc=useQueryClient(); return useMutation({mutationFn:(input:AddBrandPersonInput)=>addBrandPerson(input),retry:(n,e)=>n<2&&e instanceof PeopleServiceError&&e.retryable,
    onSuccess:async()=>{await qc.invalidateQueries({queryKey:marketingKeys.people.all(brandId)});}});
}

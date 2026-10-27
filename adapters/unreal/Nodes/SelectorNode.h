#pragma once
#include "BTNode.h"

UCLASS()
class USelectorNode : public UBTNode
{
	GENERATED_BODY()
protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		for (auto* Child : Children)
		{
			EBTNodeStatus Status = Child->Tick(Bb);
			if (Status != EBTNodeStatus::Failure)
				return Status;
		}
		return EBTNodeStatus::Failure;
	}
};
